import expressAsyncHandler from "express-async-handler";
import Users from "../models/Users.js";
import UserInfo from "../models/UserInfo.js";
import Lead from "../models/Lead.js";
import EmailLog from "../models/EmailLog.js";
import ContactMeta from "../models/ContactMeta.js";
import { sendMail, sendMailWithReason } from "../helper/mailer.js";
import { broadcastMail } from "../services/mailTemplates.js";
export const getProfile = expressAsyncHandler(async (req, res, next) => {
  const user_id = req.user._id;
  try {
    const user = await Users.findById(user_id).select(
      "name phone email profile bio"
    );
    if (user) {
      res.status(200).json({
        data: user,
        status: true,
        message: "Found",
      });
    } else {
      res.status(400);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400);
    throw new Error("Something went wrong");
  }
});

export const updateUser = expressAsyncHandler(async (req, res, next) => {
  const user = req.user;
  const { name, nickname, phone, dob, anumber, state, gender, age } = req.body;
  try {
    let profile = "";
    if (req.file) {
      profile = req.file.filename;
    }
    const filter = { _id: user._id };
    const update = {
      $set: {
        nickname: nickname,
        dob: dob,
        anumber: anumber,
        state: state,
        gender: gender,
        age: age,
      },
    };
    const options = { upsert: true };
    if (profile === "" && name === user.name && phone === user.phone) {
      await UserInfo.updateOne(filter, update, options);
      res.status(200).json({
        data: [],
        status: true,
        message: "Profile updated successfully",
      });
    } else {
      await Users.findByIdAndUpdate(
        user._id,
        { profile, name, phone },
        { new: true }
      );

      // upsert option
      await UserInfo.updateOne(filter, update, options);
      res.status(200).json({
        data: [],
        status: true,
        message: "Profile updated successfully",
      });
    }
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

export const getUser = expressAsyncHandler(async (req, res, next) => {
  const user = req.user;
  try {
    if (user.role === 1) {
      res.status(201).json({
        message: "Fetched successfully",
        data: {
          _id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          bio: user.bio,
          profile: user.profile,
        },
        status: true,
      });
    } else {
      const userInfo = await UserInfo.findById(user._id);

      res.status(201).json({
        message: "Fetched successfully",
        data: {
          _id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          bio: user.bio,
          profile: user.profile,
          nickname: userInfo ? userInfo.nickname : "",
          anumber: userInfo ? userInfo.anumber : "",
          dob: userInfo ? userInfo.dob : "",
          age: userInfo ? userInfo.age : "",
          state: userInfo ? userInfo.state : "",
          gender: userInfo ? userInfo.gender : "",
        },
        status: true,
      });
    }
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

export const getAllUserForAdmin = expressAsyncHandler(async (req, res, next) => {
  try {
     const userInfo = await Users.find({role:0}).select("name email phone profile age gender bio is_online dob").sort({ createdAt: -1 });

      res.status(201).json({
        message: "Fetched successfully",
        data:userInfo || [],
        status: true,
      });

  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

/* Chat Users page: registered users (role:0) + contact-form leads, merged and newest-first.
   Leads have no account/login, so they're tagged _source:"lead" and the frontend
   keeps them read-only (not selectable for delete/bulk-email). */
export const getChatUsersWithLeads = expressAsyncHandler(async (req, res, next) => {
  try {
    const users = await Users.find({ role: 0 })
      .select("name email phone profile age gender bio is_online dob createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const leads = await Lead.find({})
      .select("name email phone created_at")
      .sort({ created_at: -1 })
      .lean();

    const merged = [
      ...users.map(u => ({ ...u, _source: "user", _sortDate: u.createdAt })),
      ...leads.map(l => ({ ...l, _source: "lead", _sortDate: l.created_at })),
    ].sort((a, b) => new Date(b._sortDate) - new Date(a._sortDate));

    // attach meta (status + notes) to each contact
    const allIds = merged.map(u => String(u._id));
    const metas  = await ContactMeta.find({ refId: { $in: allIds } }).lean();
    const metaMap = {};
    metas.forEach(m => { metaMap[m.refId] = m; });

    const withMeta = merged.map(u => ({
      ...u,
      _status:       metaMap[String(u._id)]?.status       || "new",
      _notes:        metaMap[String(u._id)]?.notes        || "",
      _favourite:    metaMap[String(u._id)]?.favourite    || false,
      _tags:         metaMap[String(u._id)]?.tags         || [],
      _lastEmailedAt:metaMap[String(u._id)]?.lastEmailedAt|| null,
    }));

    res.status(200).json({ message: "Fetched successfully", data: withMeta, status: true });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

export const updateContactMeta = expressAsyncHandler(async (req, res) => {
  const { refId, source, status, notes, favourite, tags, lastEmailedAt } = req.body;
  if (!refId || !source) { res.status(400); throw new Error("refId and source required"); }
  const patch = { refId, source, updatedAt: new Date() };
  if (status        !== undefined) patch.status         = status;
  if (notes         !== undefined) patch.notes          = notes;
  if (favourite     !== undefined) patch.favourite      = favourite;
  if (tags          !== undefined) patch.tags           = tags;
  if (lastEmailedAt !== undefined) patch.lastEmailedAt  = lastEmailedAt;
  const meta = await ContactMeta.findOneAndUpdate({ refId }, patch, { upsert: true, new: true });
  res.status(200).json({ status: true, data: meta });
});

export const sendBulkUserMail = expressAsyncHandler(async (req, res, next) => {
  const { ids, leadEmails, subject, message, ctaText, ctaLink, nameEmoji = "💚" } = req.body;
  if (!Array.isArray(ids)) {
    res.status(400);
    throw new Error("ids must be an array");
  }
  if (ids.length === 0 && (!Array.isArray(leadEmails) || leadEmails.length === 0)) {
    res.status(400);
    throw new Error("No recipients — provide ids or leadEmails");
  }
  if (!subject?.trim() || !message?.trim()) {
    res.status(400);
    throw new Error("subject and message are required");
  }
  try {
    const users = await Users.find({ _id: { $in: ids }, role: 0 }).select("name email");

    const buildHtml = (firstName) =>
      broadcastMail({ firstName, message, ctaText, ctaLink });

    // build lazy send functions (not invoked yet) so sending is actually throttled by the batch loop below
    const tasks = [];
    const recipientMeta = [];

    for (const u of users) {
      if (!u.email) continue;
      const firstName = u.name ? u.name.split(" ")[0] : "";
      const fromName = firstName ? `Hii, ${firstName} ${nameEmoji}` : `Hii, ${nameEmoji}`;
      recipientMeta.push({ name: u.name || "", email: u.email });
      tasks.push(() => sendMailWithReason(u.email, subject, message, buildHtml(firstName || "there"), fromName));
    }

    if (Array.isArray(leadEmails)) {
      for (const lead of leadEmails) {
        const email = typeof lead === "string" ? lead : lead.email;
        const name = typeof lead === "object" && lead.name ? lead.name : "";
        const firstName = name ? name.split(" ")[0] : "";
        if (!email) continue;
        const fromName = firstName ? `Hii, ${firstName} ${nameEmoji}` : `Hii, ${nameEmoji}`;
        recipientMeta.push({ name, email });
        tasks.push(() => sendMailWithReason(email, subject, message, buildHtml(firstName || "there"), fromName));
      }
    }

    // send in batches with a cooldown between batches to stay under the SMTP provider's rate limit
    const BATCH = 10;
    const BATCH_DELAY_MS = 3000;
    let sentCount = 0;
    let failCount = 0;
    const recipientsLog = [];
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < tasks.length; i += BATCH) {
      const batch = tasks.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(task => task()));
      results.forEach((r, j) => {
        const meta = recipientMeta[i + j];
        const success = r.status === "fulfilled" && r.value?.success === true;
        const error = r.status === "fulfilled" ? r.value?.error : r.reason?.message;
        if (success) sentCount++; else failCount++;
        recipientsLog.push({ name: meta.name, email: meta.email, status: success ? "sent" : "failed", ...(error ? { error } : {}) });
      });
      if (i + BATCH < tasks.length) await sleep(BATCH_DELAY_MS);
    }

    await EmailLog.create({ subject, message, sentCount, failCount, recipients: recipientsLog });

    // stamp lastEmailedAt for sent recipients
    const sentEmails = recipientsLog.filter(r=>r.status==="sent").map(r=>r.email);
    const allContacts = await Promise.all([
      Users.find({ email: { $in: sentEmails }, role: 0 }).select("_id email"),
    ]);
    const now = new Date();
    for (const u of allContacts[0]) {
      await ContactMeta.findOneAndUpdate({ refId: String(u._id) }, { lastEmailedAt: now, updatedAt: now }, { upsert: false });
    }

    res.status(200).json({
      status: true,
      message: `Email sent to ${sentCount} contact(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
      sentCount,
      failCount,
    });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

export const getEmailLogs = expressAsyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const total = await EmailLog.countDocuments();
  const logs = await EmailLog.find({})
    .sort({ sentAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select("subject sentCount failCount sentAt recipients");
  res.status(200).json({ status: true, data: logs, total, page, pages: Math.ceil(total / limit) });
});

