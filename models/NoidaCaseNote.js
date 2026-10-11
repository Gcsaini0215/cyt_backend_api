import mongoose from "mongoose";
const { Schema } = mongoose;

/* Handwritten case notes for one Noida booking, written with a pen on the reception iPad.
   Pages hold the ink as vector strokes on a fixed page (PAGE_W x PAGE_H units), so they
   redraw sharply on any screen. Saved as the therapist writes; one document per booking. */
const noidaCaseNoteSchema = new Schema({
  appointment: { type: Schema.Types.ObjectId, ref: "NoidaAppointment", required: true, unique: true },
  phone:       { type: String, default: "" },
  clientCode:  { type: String, default: "" },
  name:        { type: String, default: "" },
  // [{ strokes: [{ c: "#hex", w: number, e?: true (eraser), p: [x, y, pressure, x, y, pressure, ...] }] }]
  pages:       { type: Schema.Types.Mixed, default: () => [{ strokes: [] }] },
  updatedByName: { type: String, default: "" },
}, { timestamps: true, minimize: false });

noidaCaseNoteSchema.index({ phone: 1, updatedAt: -1 });

export default mongoose.model("NoidaCaseNote", noidaCaseNoteSchema);
