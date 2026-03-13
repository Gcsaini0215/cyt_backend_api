import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function checkSubscriptions() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const count = await mongoose.connection.collection('pushsubscriptions').countDocuments();
        console.log('Total Subscriptions in DB:', count);
        
        if (count > 0) {
            const subs = await mongoose.connection.collection('pushsubscriptions').find().limit(5).toArray();
            console.log('Recent Subscriptions:', JSON.stringify(subs, null, 2));
        }
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSubscriptions();
