import express from "express";
import userRoutes from "./routes/user.js";
import authRouter from "./routes/auth.js";
import testRouter from "./routes/test.js";
import therapistRouter from "./routes/therapist.js";
import newsletterRouter from "./routes/newsletter.js";
import workshopRouter from "./routes/workshop.js";
import favriouteRouter from "./routes/favrioute.js";
import bookingRouter from "./routes/booking.js";
import coupanRouter from "./routes/coupan.js";
import smsRouter from "./routes/sms.js";
import transactionRouter from "./routes/transaction.js";
import dashboardRouter from "./routes/dashboard.js";
import shareRouter from "./routes/share.js";
import leadRouter from "./routes/lead.js";
import clinicLogRouter from "./routes/clinicLog.js";
import blogRouter from "./routes/blog.js";
import pushRouter from "./routes/push.js";
import rolesRouter from "./routes/roles.js";
import teamRouter from "./routes/team.js";
import resourceRouter from "./routes/resource.js";
import reminderRouter from "./routes/reminder.js";
import intakeClientsRouter from "./routes/intakeClients.js";
import { notFound, errorHandler } from "./middlewares/errorMiddleware.js";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.set('trust proxy', 1);

app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "https://chooseyourtherapist.in",
    "https://cyt.chooseyourtherapist.in",
    "https://www.chooseyourtherapist.in",
    "https://www.cyt.chooseyourtherapist.in",
    "https://api.chooseyourtherapist.in",
    "http://api.chooseyourtherapist.in",
    "http://195.35.21.126:3000",
    "http://195.35.21.126:4000",
    "http://195.35.21.126",
    "http://192.168.1.1:3000",
    "http://192.168.1.1:4000"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
  credentials: true,
}));

app.options("*", cors());

global.appRoot = path.resolve(__dirname);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use("/api", userRoutes);
app.use("/api", dashboardRouter);
app.use("/api", authRouter);
app.use("/api", therapistRouter);
app.use("/api", newsletterRouter);
app.use("/api", workshopRouter);
app.use("/api/coupon", coupanRouter);
app.use("/api", smsRouter);
app.use("/api", favriouteRouter);
app.use("/api", bookingRouter);
app.use("/api", transactionRouter);
app.use("/api", leadRouter);
app.use("/api", clinicLogRouter);
app.use("/api", blogRouter);
app.use("/api/notifications", pushRouter);
app.use("/api", rolesRouter);
app.use("/api", teamRouter);
app.use("/api", resourceRouter);
app.use("/api", reminderRouter);
app.use("/api", intakeClientsRouter);
app.use("/share", shareRouter);
app.use("/", testRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
