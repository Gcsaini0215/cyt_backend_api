import { Router } from "express";
import {
  staffAuth, staffManager, staffStream,
  getMyDay, checkIn, checkOut, setTaskStatus, readNotice,
  getTeam, getAttendance, editAttendance,
  listTasks, createTask, updateTask, deleteTask,
  listNotices, createNotice, deleteNotice,
  getStaffSettings, updateStaffSettings, setTarget,
  applyLeave, cancelLeave, listLeaves, decideLeave,
  applyWfh, cancelWfh, listWfh, decideWfh,
} from "../controllers/StaffController.js";

const router = Router();

/* any admin — their own day */
router.get("/staff/stream", staffAuth, staffStream);          // live updates (SSE), token in ?token=
router.get("/staff/me", staffAuth, getMyDay);
router.post("/staff/check-in", staffAuth, checkIn);
router.post("/staff/check-out", staffAuth, checkOut);
router.patch("/staff/tasks/:id/status", staffAuth, setTaskStatus);
router.post("/staff/notices/:id/read", staffAuth, readNotice);
router.post("/staff/leaves", staffAuth, applyLeave);
router.delete("/staff/leaves/:id", staffAuth, cancelLeave);
router.post("/staff/wfh", staffAuth, applyWfh);
router.delete("/staff/wfh/:id", staffAuth, cancelWfh);

/* managers — Super Admin, or a role with the "staff" permission */
router.get("/staff/team", staffAuth, staffManager, getTeam);
router.get("/staff/attendance", staffAuth, staffManager, getAttendance);
router.patch("/staff/attendance", staffAuth, staffManager, editAttendance);
router.get("/staff/tasks", staffAuth, staffManager, listTasks);
router.post("/staff/tasks", staffAuth, staffManager, createTask);
router.patch("/staff/tasks/:id", staffAuth, staffManager, updateTask);
router.delete("/staff/tasks/:id", staffAuth, staffManager, deleteTask);
router.get("/staff/notices", staffAuth, staffManager, listNotices);
router.post("/staff/notices", staffAuth, staffManager, createNotice);
router.delete("/staff/notices/:id", staffAuth, staffManager, deleteNotice);
router.get("/staff/settings", staffAuth, staffManager, getStaffSettings);
router.put("/staff/settings", staffAuth, staffManager, updateStaffSettings);
router.put("/staff/targets", staffAuth, staffManager, setTarget);
router.get("/staff/leaves", staffAuth, staffManager, listLeaves);
router.patch("/staff/leaves/:id", staffAuth, staffManager, decideLeave);
router.get("/staff/wfh", staffAuth, staffManager, listWfh);
router.patch("/staff/wfh/:id", staffAuth, staffManager, decideWfh);

export default router;
