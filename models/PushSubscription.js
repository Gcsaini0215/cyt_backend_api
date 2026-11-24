import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Users",
        required: false
    },
    // "admin" = a CYT admin's phone (Live Chats alerts); empty = a client / therapist (website)
    scope: { type: String, default: "" },
    subscription: {
        endpoint: { type: String, required: true },
        expirationTime: { type: Number, default: null },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true }
        }
    }
}, { timestamps: true });

export default mongoose.model("PushSubscription", pushSubscriptionSchema);
