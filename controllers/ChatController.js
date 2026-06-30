import ChatMessage from "../models/ChatMessage.js";
import User from "../models/Users.js";

/* GET /chat/messages?therapistId=xxx  — fetch conversation */
export const getMessages = async (req, res) => {
  try {
    const userId = req.user._id;
    const { therapistId } = req.query;
    if (!therapistId) return res.status(400).json({ success: false, message: "therapistId required" });

    const messages = await ChatMessage.find({ therapistId, userId })
      .sort({ createdAt: 1 })
      .lean();

    // mark unread messages as read
    await ChatMessage.updateMany(
      { therapistId, userId, sender: "therapist", readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* POST /chat/send — send a message */
export const sendMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { therapistId, message } = req.body;
    if (!therapistId || !message?.trim()) return res.status(400).json({ success: false, message: "therapistId and message required" });

    const msg = await ChatMessage.create({
      therapistId,
      userId,
      sender: "user",
      message: message.trim(),
    });

    res.status(201).json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* GET /chat/unread-count?therapistId=xxx */
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const { therapistId } = req.query;
    if (!therapistId) return res.status(400).json({ success: false, message: "therapistId required" });

    const count = await ChatMessage.countDocuments({ therapistId, userId, sender: "therapist", readAt: null });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── THERAPIST SIDE ──────────────────────────────────────────────── */

/* GET /chat/therapist/conversations — list all users who messaged this therapist */
export const getConversations = async (req, res) => {
  try {
    const therapistId = req.user._id;

    // get distinct userIds
    const userIds = await ChatMessage.distinct("userId", { therapistId });

    // for each userId get last message + unread count
    const conversations = await Promise.all(userIds.map(async (userId) => {
      const last = await ChatMessage.findOne({ therapistId, userId })
        .sort({ createdAt: -1 }).populate("userId", "name email").lean();
      const unread = await ChatMessage.countDocuments({ therapistId, userId, sender: "user", readAt: null });
      return { userId, user: last?.userId || null, lastMessage: last, unread };
    }));

    // sort by last message time desc
    conversations.sort((a, b) => new Date(b.lastMessage?.createdAt) - new Date(a.lastMessage?.createdAt));

    res.json({ success: true, data: conversations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* GET /chat/therapist/messages?userId=xxx — get full thread with a user */
export const getThreadAsTherapist = async (req, res) => {
  try {
    const therapistId = req.user._id;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const messages = await ChatMessage.find({ therapistId, userId })
      .sort({ createdAt: 1 }).lean();

    // mark user messages as read
    await ChatMessage.updateMany(
      { therapistId, userId, sender: "user", readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* POST /chat/therapist/send — therapist replies */
export const therapistSendMessage = async (req, res) => {
  try {
    const therapistId = req.user._id;
    const { userId, message } = req.body;
    if (!userId || !message?.trim()) return res.status(400).json({ success: false, message: "userId and message required" });

    const msg = await ChatMessage.create({ therapistId, userId, sender: "therapist", message: message.trim() });
    res.status(201).json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
