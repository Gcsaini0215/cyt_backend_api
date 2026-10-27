import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Therapists from "../models/Therapists.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { SESSION_STATUS } from "../helper/status.js";
import { createMeetWithTimeout, deleteMeetEvent, isOnlineFormat } from "../helper/googleMeet.js";
import { syncNoidaBooking } from "../helper/noidaBookingSync.js";
import { notifyTherapists, therapistBookingsChanged, therapistUserId } from "../services/therapistNotify.js";
import { notifyClient, changed as clientBookingsChanged } from "../services/clientNotify.js";

const nameOf = (t) => String(t?.user?.name || "").replace(/\s+/g, " ").trim() || "Therapist";
const whenOf = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/* Admin → Client 360 → Replace therapist. Moves one session that hasn't started to another
   therapist and keeps a record of it on the booking (booking.reassignments), which Client 360
   and the new therapist's dashboard show. Online sessions get a fresh Meet link on the new
   therapist's calendar; a CYT Noida session is moved through its appointment (helper/noidaBookingSync). */
export const reassignBooking = expressAsyncHandler(async (req, res) => {
  const { therapistId, reason = "" } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(therapistId)) {
    res.status(400); throw new Error("Choose the therapist to move this session to");
  }
  const b = await Booking.findById(req.params.id).populate({ path: "therapist", select: "_id user", populate: { path: "user", select: "name" } });
  if (!b) { res.status(404); throw new Error("Session not found"); }
  if (String(b.therapist?._id) === String(therapistId)) { res.status(400); throw new Error("This session is already with that therapist"); }
  if ([SESSION_STATUS.CANCELED, SESSION_STATUS.COMPLETED, SESSION_STATUS.STARTED].includes(b.status) || b.session_started_at || b.session_completed_at) {
    res.status(400); throw new Error("Only a session that hasn't started yet can be moved");
  }
  if (b.payout_id) { res.status(400); throw new Error("This session is already part of a therapist payout"); }

  const to = await Therapists.findById(therapistId).select("_id user").populate("user", "name");
  if (!to) { res.status(404); throw new Error("Therapist not found"); }
  // the new therapist mustn't already have a session at that time
  const clash = await Booking.exists({ _id: { $ne: b._id }, therapist: to._id, booking_date: b.booking_date, status: { $ne: SESSION_STATUS.CANCELED } });
  if (clash) { res.status(409); throw new Error(`${nameOf(to)} already has a session at that time`); }

  const from = b.therapist;
  const entry = {
    from: from?._id, fromName: nameOf(from), to: to._id, toName: nameOf(to),
    reason: String(reason).replace(/\s+/g, " ").trim().slice(0, 300), by: req.user?.name || "CYT team", at: new Date(),
  };
  const client = b.cname || "A client";
  const when = whenOf(b.booking_date);

  if (b.source === "noida" && b.noida_appointment) {
    // the Noida appointment decides the therapist; the sync moves the booking, tells the new
    // therapist and refreshes both dashboards
    await NoidaAppointment.updateOne({ _id: b.noida_appointment }, { $set: { therapist: to._id, therapistName: nameOf(to) } });
    await Booking.updateOne({ _id: b._id }, { $push: { reassignments: entry } });
    await syncNoidaBooking(b.noida_appointment);
  } else {
    if (b.calendar_event_id) await deleteMeetEvent(b); // off the old therapist's calendar
    b.set({ therapist: to._id, meet_link: "", calendar_event_id: "", therapist_joined_at: null, client_joined_at: null });
    b.reassignments.push(entry);
    await b.save();
    if (b.payment_status === "Paid" && isOnlineFormat(b.format)) {
      const full = await Booking.findById(b._id).populate("client", "name email").populate({ path: "therapist", select: "_id user", populate: { path: "user", select: "name email" } });
      const meet = await createMeetWithTimeout(full);
      if (meet) await Booking.updateOne({ _id: b._id }, { $set: { meet_link: meet.link, calendar_event_id: meet.eventId } });
    }
    therapistBookingsChanged(to.user?._id);
    notifyTherapists([to.user?._id], {
      type: "booking", title: "A client has been assigned to you",
      body: `${client} · ${when} — moved to you by the CYT team (earlier with ${entry.fromName})${entry.reason ? `. Reason: ${entry.reason}` : ""}`,
      link: "/appointments", ref: `reassign:${b._id}:${to._id}`,
    }).catch(() => {});
  }

  const fromUser = await therapistUserId(from);
  therapistBookingsChanged(fromUser);
  notifyTherapists([fromUser], {
    type: "booking", title: "A session moved to another psychologist",
    body: `${client} · ${when} is now with ${entry.toName} (changed by the CYT team).`,
    link: "/appointments", ref: `reassign-from:${b._id}:${to._id}`,
  }).catch(() => {});
  if (b.client) {
    notifyClient(b.client, {
      type: "booking", title: "Your session has a new psychologist",
      body: `Your session on ${when} is now with ${entry.toName}.`, link: "/client/my-bookings", ref: `reassign:${b._id}:${to._id}`,
    }).catch(() => {});
    clientBookingsChanged(b.client);
  }
  res.json({ status: true, message: `Session moved to ${entry.toName}`, data: entry });
});
