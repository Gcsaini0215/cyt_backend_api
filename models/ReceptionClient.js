import mongoose from "mongoose";

/* Walk-in / in-person clients managed from the admin "Reception" area.
   The admin UI owns the full object shape (package, payments[],
   attendance[], followUps[], notes[], status, timestamps as numbers),
   so this is a permissive mirror keyed by the UI-generated string `id`.
   No mongoose `timestamps` — the UI keeps its own numeric `createdAt`. */
const ReceptionClientSchema = new mongoose.Schema(
  { id: { type: String, required: true, unique: true, index: true } },
  { strict: false, minimize: false }
);

export default mongoose.model("ReceptionClient", ReceptionClientSchema);
