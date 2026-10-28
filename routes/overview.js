import express from "express";
import { overviewSummary } from "../controllers/OverviewController.js";
import { activityFeed } from "../controllers/AdminFeedController.js";
import { clientGrowth } from "../controllers/ClientGrowthController.js";
import { adminTodo, adminSearch } from "../controllers/AdminTodoController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
// any admin who can see at least one module
router.get("/admin/overview-summary", hasPermission(["noidaCenter", "therapists", "probono", "clients", "bookings", "invoices", "leads", "reviews"]), overviewSummary);
router.get("/admin/activity-feed", hasPermission(["noidaCenter", "therapists", "probono", "clients", "bookings", "invoices", "leads", "reviews", "blogs", "notifications", "resources", "certificates", "reports", "staff", "quotations", "offerLetters", "letterheads", "outreach", "bdm"]), activityFeed);
// client portal: rebook / review / referral / recovered payments / rebook nudges
router.get("/admin/client-growth", hasPermission(["clients", "bookings"]), clientGrowth);
// everything waiting on the team (admin Home / To-do); the page filters items by what the admin can open
router.get("/admin/todo", hasPermission(["noidaCenter", "therapists", "probono", "clients", "bookings", "invoices", "leads", "reviews", "staff"]), adminTodo);
router.get("/admin/search", hasPermission(["clients", "therapists", "bookings", "leads", "noidaCenter"]), adminSearch);
export default router;
