const mongoose = require("mongoose");

const carSchema = new mongoose.Schema(
    {
   owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    model: { type: String, required: true },
    year: { type: Number, required: true, min: 1885 },
    mpg: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "" }, 
    fuel: { type: String, enum: ["gasoline", "diesel", "electric", "hybrid"], default: "gasoline" },
    isElectric: { type: Boolean, default: false },
    transmission: { type: String, enum: ["auto", "manual"], default: "auto" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Car", carSchema);