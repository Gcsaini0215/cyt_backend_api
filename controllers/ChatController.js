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
