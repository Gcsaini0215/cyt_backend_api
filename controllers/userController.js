import expressAsyncHandler from "express-async-handler";
import Users from "../models/Users.js";
import UserInfo from "../models/UserInfo.js";
import Lead from "../models/Lead.js";
import { sendMail } from "../helper/mailer.js";
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

    res.status(200).json({
      message: "Fetched successfully",
      data: merged,
      status: true,
    });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

export const sendBulkUserMail = expressAsyncHandler(async (req, res, next) => {
  const { ids, leadEmails, subject, message, ctaText, ctaLink, nameEmoji = "💚" } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("ids array is required");
  }
  if (!subject?.trim() || !message?.trim()) {
    res.status(400);
    throw new Error("subject and message are required");
  }
  try {
    const users = await Users.find({ _id: { $in: ids }, role: 0 }).select("name email");

    const ctaBlock = (ctaText?.trim() && ctaLink?.trim())
      ? `<div style="text-align:left;margin-top:28px">
            <a href="${ctaLink.trim()}" title="${ctaText.trim()}" style="display:inline-block;background:#ffffff;color:#1a6b3a;text-decoration:none;border:1.5px solid #1a6b3a;border-radius:8px;padding:12px 30px;font-weight:700;font-size:13px;letter-spacing:0.2px">
              ${ctaText.trim()}
            </a>
          </div>`
      : "";

    const buildHtml = (firstName) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <tr><td style="background:linear-gradient(135deg,#0d4a28,#1a6b3a,#228756);padding:24px 36px">
          <img src="https://chooseyourtherapist.in/assets/img/favicon.png" alt="CYT" width="36" height="36" style="display:inline-block;vertical-align:middle;border-radius:8px;margin-right:12px" />
          <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px;vertical-align:middle">Choose Your Therapist</span>
        </td></tr>
        <tr><td style="padding:32px 36px">
          <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:16px">Hi ${firstName}, ${nameEmoji}</div>
          <div style="font-size:14px;color:#475569;line-height:1.8;white-space:pre-wrap">${message}</div>
          ${ctaBlock}
        </td></tr>
        <tr><td style="background:#f1f5f9;border-top:1.5px solid #e2e8f0;padding:16px 36px">
          <div style="font-size:12px;color:#64748b;line-height:1.9">
            📞 +91-8077757951<br>
            ✉ hello@chooseyourtherapist.in<br>
            🌐 chooseyourtherapist.in
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    let sentCount = 0;

    // Registered users
    for (const u of users) {
      if (!u.email) continue;
      const firstName = u.name ? u.name.split(" ")[0] : "";
      const fromName = firstName ? `Hii, ${firstName}` : "CYT Team";
      const ok = await sendMail(u.email, subject, message, buildHtml(firstName || "there"), fromName);
      if (ok) sentCount++;
    }

    // Leads (no User doc, just email strings — no name available)
    if (Array.isArray(leadEmails)) {
      for (const email of leadEmails) {
        if (!email) continue;
        const ok = await sendMail(email, subject, message, buildHtml("there"), "CYT Team");
        if (ok) sentCount++;
      }
    }

    res.status(200).json({
      status: true,
      message: `Email sent to ${sentCount} contact(s)`,
      sentCount,
    });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

