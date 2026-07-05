import mongoose from "mongoose";
import pg from "pg";

const MONGODB_URI = "mongodb+srv://Gcsaini:Gcsaini0215@teamtodo.71csztx.mongodb.net/cyt";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL env variable required");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

// ── MongoDB schemas ──────────────────────────────────────────
const Schema = mongoose.Schema;

const UserSchema = new Schema({ name: String, email: String, phone: String, profile: String, bio: String, role: Number, gender: String, age: Number, dob: String, is_verified: Number, createdAt: Date }, { timestamps: true });
const User = mongoose.model("User", UserSchema);

const TherapistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User" },
  serve_type: String, profile_type: String, mode: String, profile_code: String,
  state: String, office_address: String, year_of_exp: String, qualification: String,
  language_spoken: String, session_formats: String, services: String, experties: String,
  fees: Array, availabilities: Array, priority: Number, show_to_page: Number,
}, { timestamps: true });
const Therapist = mongoose.model("Therapists", TherapistSchema);

const ReviewSchema = new Schema({ therapist_id: Schema.Types.ObjectId, name: String, email: String, rating: Number, description: String }, { timestamps: true });
const Review = mongoose.model("Review", ReviewSchema);

// ── Helpers ──────────────────────────────────────────────────
function parseLanguages(str) {
  if (!str) return [];
  return str.split(/[,،]+/).map(s => s.trim()).filter(Boolean);
}

function parseSessionTypes(mode, formats) {
  const types = [];
  const combined = `${mode || ""} ${formats || ""}`.toLowerCase();
  if (combined.includes("video")) types.push("video");
  if (combined.includes("audio")) types.push("audio");
  if (combined.includes("in-person") || combined.includes("in person") || combined.includes("offline")) types.push("in-person");
  return types.length ? types : ["video"];
}

function parseServices(services) {
  if (!services) return [];
  return services.split(/[,،\n]+/).map(s => s.trim()).filter(Boolean);
}

function getSessionFee(fees) {
  if (!fees || !fees.length) return 0;
  for (const f of fees) {
    for (const fmt of (f.formats || [])) {
      if (fmt.fee && fmt.fee > 0) return fmt.fee;
    }
  }
  return 0;
}

function getVideoFee(fees) {
  for (const f of (fees || [])) {
    for (const fmt of (f.formats || [])) {
      if (fmt.type === "video" && fmt.fee) return fmt.fee;
    }
  }
  return null;
}

function getAudioFee(fees) {
  for (const f of (fees || [])) {
    for (const fmt of (f.formats || [])) {
      if (fmt.type === "audio" && fmt.fee) return fmt.fee;
    }
  }
  return null;
}

function getInPersonFee(fees) {
  for (const f of (fees || [])) {
    for (const fmt of (f.formats || [])) {
      if ((fmt.type === "in-person" || fmt.type === "offline") && fmt.fee) return fmt.fee;
    }
  }
  return null;
}

function parseProfileType(profile_type, services) {
  const pt = (profile_type || "").toLowerCase();
  if (pt.includes("couple")) return "couples";
  if (pt.includes("school") || pt.includes("teen") || pt.includes("child")) return "school";
  if (pt.includes("corporate") || pt.includes("workplace")) return "corporate";
  if (pt.includes("community")) return "community";
  return "therapy";
}

// ── Main migration ────────────────────────────────────────────
async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected");

  // Fetch all data
  const therapists = await Therapist.find({}).populate("user").lean();
  const reviews = await Review.find({}).lean();

  console.log(`Found ${therapists.length} therapists, ${reviews.length} reviews`);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let therapistCount = 0;
    let userCount = 0;

    for (const t of therapists) {
      const u = t.user;
      if (!u) continue;

      // Skip if no name or email
      if (!u.name || !u.email) continue;

      const therapistId = t._id.toString();
      const userName = u.name;
      const userEmail = u.email;
      const userPhone = u.phone || null;
      const userGender = u.gender || null;

      // Upsert user
      const userRes = await client.query(
        `INSERT INTO users (name, email, phone, gender, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userName, userEmail, userPhone, userGender, u.createdAt || new Date()]
      );
      userCount++;

      // Build therapist photo URL
      const photo = u.profile && !u.profile.includes("pngegg")
        ? u.profile
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=1b4332&color=fff&size=200`;

      const sessionTypes = parseSessionTypes(t.mode, t.session_formats);
      const languages = parseLanguages(t.language_spoken);
      const concerns = parseServices(t.experties || t.services);
      const sessionFee = getSessionFee(t.fees);
      const videoFee = getVideoFee(t.fees);
      const audioFee = getAudioFee(t.fees);
      const inPersonFee = getInPersonFee(t.fees);
      const profileType = parseProfileType(t.profile_type, t.services);
      const location = t.office_address || t.state || "India";
      const state = t.state || "";
      const experience = parseInt(t.year_of_exp) || 0;
      const education = t.qualification || "";
      const isActive = (t.show_to_page === 1);

      // Upsert therapist
      await client.query(
        `INSERT INTO therapists (
          id, name, photo, specializations, languages, experience, rating, review_count,
          session_fee, video_fee, audio_fee, in_person_fee, bio, approach,
          session_types, availability, gender, location, state, is_verified,
          education, concerns, profile_type, is_active, email, phone, status, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          photo = EXCLUDED.photo,
          specializations = EXCLUDED.specializations,
          languages = EXCLUDED.languages,
          experience = EXCLUDED.experience,
          session_fee = EXCLUDED.session_fee,
          video_fee = EXCLUDED.video_fee,
          audio_fee = EXCLUDED.audio_fee,
          in_person_fee = EXCLUDED.in_person_fee,
          session_types = EXCLUDED.session_types,
          gender = EXCLUDED.gender,
          location = EXCLUDED.location,
          state = EXCLUDED.state,
          education = EXCLUDED.education,
          concerns = EXCLUDED.concerns,
          profile_type = EXCLUDED.profile_type,
          is_active = EXCLUDED.is_active,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone`,
        [
          therapistId, userName, photo,
          concerns.slice(0, 5),   // specializations = top concerns
          languages.length ? languages : ["Hindi", "English"],
          experience,
          0, 0,                   // rating, review_count (recalculated below)
          sessionFee || 0, videoFee, audioFee, inPersonFee,
          "", "",                 // bio, approach
          sessionTypes,
          [],                     // availability
          (u.gender || "other").toLowerCase(),
          location, state,
          (u.is_verified === 1),
          education,
          concerns,
          profileType,
          isActive,
          userEmail, userPhone,
          "approved",
          t.createdAt || new Date()
        ]
      );
      therapistCount++;
    }

    // Migrate reviews & update ratings
    let reviewCount = 0;
    for (const r of reviews) {
      const therapistId = r.therapist_id?.toString();
      if (!therapistId) continue;

      // Check therapist exists
      const exists = await client.query("SELECT id FROM therapists WHERE id = $1", [therapistId]);
      if (!exists.rows.length) continue;

      // Find user by email
      const userRes = await client.query("SELECT id FROM users WHERE email = $1", [r.email]);
      const userId = userRes.rows[0]?.id;
      if (!userId) continue;

      await client.query(
        `INSERT INTO reviews (user_id, therapist_id, rating, comment, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [userId, therapistId, r.rating, r.description || "", r.createdAt || new Date()]
      );
      reviewCount++;
    }

    // Update therapist ratings from reviews
    await client.query(`
      UPDATE therapists t SET
        rating = sub.avg_rating,
        review_count = sub.cnt
      FROM (
        SELECT therapist_id, ROUND(AVG(rating)::numeric, 1) as avg_rating, COUNT(*) as cnt
        FROM reviews GROUP BY therapist_id
      ) sub
      WHERE t.id = sub.therapist_id
    `);

    await client.query("COMMIT");

    console.log(`\n✅ Migration complete!`);
    console.log(`   Users:      ${userCount}`);
    console.log(`   Therapists: ${therapistCount}`);
    console.log(`   Reviews:    ${reviewCount}`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }

  await mongoose.disconnect();
  await pool.end();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
