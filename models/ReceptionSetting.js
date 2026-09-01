import mongoose from "mongoose";

/* Small key/value store for the Reception area — currently just the
   editable package charges under key "plan_prices". */
const ReceptionSettingSchema = new mongoose.Schema(
  {
    key:   { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { minimize: false, timestamps: true }
);

export default mongoose.model("ReceptionSetting", ReceptionSettingSchema);
