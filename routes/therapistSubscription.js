import { Router } from "express";
import { getTherapistSubscriptions, getTherapistSubscriptionPayments, remindTherapistSubscription, grantFreeSubscription, getReminderTemplates } from "../controllers/TherapistSubscriptionController.js";
import { hasPermission, isTherapist } from "../middlewares/authMiddleware.js";
import { hideRevenueForTeam } from "../middlewares/hideRevenueMiddleware.js";
import { myPlans } from "../controllers/MyPlansController.js";

const router = Router();

// therapist portal → My plans: listing package + add-ons, status and full history
router.get("/therapist/my-plans", isTherapist, myPlans);

router.get("/admin/therapist-subscriptions", hasPermission("therapists"), hideRevenueForTeam, getTherapistSubscriptions);
router.get("/admin/therapist-subscriptions/reminder-templates", hasPermission("therapists"), getReminderTemplates);
router.post("/admin/therapist-subscriptions/:userId/remind", hasPermission("therapists"), remindTherapistSubscription);
router.post("/admin/therapist-subscriptions/:userId/free", hasPermission("therapists"), grantFreeSubscription);
router.get("/admin/therapist-subscriptions/:userId/payments", hasPermission("therapists"), hideRevenueForTeam, getTherapistSubscriptionPayments);

export default router;
