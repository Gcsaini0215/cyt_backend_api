import mongoose from "mongoose";
const { model, Schema } = mongoose;

// A licence a therapist holds to use a copyrighted questionnaire (ISI, PSS-10, BDI-II…). Clients who
// want that questionnaire are shown only therapists with a current licence for it.
export const LICENSED_TOOLS = ["isi", "psqi", "who5", "pss10", "ocir", "spin", "sdq", "bdi2", "bai"];

const TherapistLicenceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // the therapist's user id
    tool: { type: String, required: true, enum: LICENSED_TOOLS },
    details: { type: String, required: true, maxlength: 400 }, // licence / permission no., issued by
    validTill: { type: Date, default: null }, // null = no end date
  },
  { timestamps: true }
);
TherapistLicenceSchema.index({ user: 1, tool: 1 }, { unique: true });
TherapistLicenceSchema.index({ tool: 1 });

export default model("TherapistLicence", TherapistLicenceSchema);
