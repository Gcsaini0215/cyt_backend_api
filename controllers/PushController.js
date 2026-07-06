import expressAsyncHandler from "express-async-handler";
import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";
import dotenv from "dotenv";

dotenv.config();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_MAILTO || "mailto:support@chooseyourtherapist.in",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
} else {
    console.warn("Push Notifications disabled: Missing VAPID keys");
}

export const subscribe = expressAsyncHandler(async (req, res) => {
    const subscription = req.body.subscription || req.body;
    const userId = req.user ? req.user._id : null;
    const existingSubscription = await PushSubscription.findOne({ 'subscription.endpoint': subscription.endpoint });
    if (existingSubscription) {
        existingSubscription.userId = userId;
        await existingSubscription.save();
    } else {
        const newSubscription = new PushSubscription({ userId, subscription });
        await newSubscription.save();
    }
    res.status(201).json({ message: "Subscription saved successfully" });
});

export const sendNotification = expressAsyncHandler(async (req, res) => {
    const { title, body, url, userId } = req.body;
    let query = {}; if (userId) query.userId = userId;
    await pushToUsers(query, title, body, url);
    res.status(200).json({ message: "Notifications sent successfully" });
});

export const pushToUsers = async (query, title, body, url) => {
    const payload = JSON.stringify({ title, body, url: url || '/' });
    const subscriptions = await PushSubscription.find(query);
    const notifications = subscriptions.map(sub => {
        return webpush.sendNotification(sub.subscription, payload).catch(err => {
            if (err.statusCode === 410) return PushSubscription.deleteOne({ _id: sub._id });
            console.error("Error sending notification", err);
        });
    });
    await Promise.all(notifications);
};