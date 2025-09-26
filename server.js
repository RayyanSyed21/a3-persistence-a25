require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const expressLayouts = require("express-ejs-layouts");

const User = require("./models/User");
const Car = require("./models/Car");

const app = express();


app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan("dev"));
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);


app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


const MONGODB_URI =
  process.env.MONGODB_URI || 
  process.env.MONGO_URI || 
  "mongodb://127.0.0.1:27017/a3";


mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Mongo connected"))
  .catch((err) => {
    console.error("Mongo connection error", err);
    process.exit(1);
  });


const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
app.use(
  session({
    secret: SESSION_SECRET, 
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 8, httpOnly: true, sameSite: "lax" },
  })
);


function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/");
  next();
}
app.use((req, res, next) => {
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});


app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("login", { title: "Login • Car Tracker" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.session.flash = "Username and password required.";
    return res.redirect("/");
  }
  const existing = await User.findOne({ username });
  if (!existing) {
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash });
    req.session.userId = user._id;
    req.session.flash = "New account created and logged in.";
    return res.redirect("/dashboard");
  }
  const ok = await bcrypt.compare(password, existing.password);
  if (!ok) {
    req.session.flash = "Incorrect password.";
    return res.redirect("/");
  }
  req.session.userId = existing._id;
  res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/dashboard", requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).lean();
  const cars = await Car.find({ owner: user._id })
    .sort({ createdAt: -1 })
    .lean();
  res.render("dashboard", { title: "Dashboard • Car Tracker", user, cars });
});


app.post("/cars", requireAuth, async (req, res) => {
  const payload = {
    owner: req.session.userId,
    model: req.body.model,
    year: Number(req.body.year),
    mpg: Number(req.body.mpg),
    notes: req.body.notes || "",
    fuel: req.body.fuel || "gasoline",
    isElectric:
      req.body.isElectric === "on" ||
      req.body.isElectric === true ||
      req.body.isElectric === "true",
    transmission: req.body.transmission || "auto",
  };
  await Car.create(payload);
  res.redirect("/dashboard");
});

app.post("/cars/:id/update", requireAuth, async (req, res) => {
  const { id } = req.params;
  const update = {
    model: req.body.model,
    year: Number(req.body.year),
    mpg: Number(req.body.mpg),
    notes: req.body.notes || "",
    fuel: req.body.fuel || "gasoline",
    isElectric:
      req.body.isElectric === "on" ||
      req.body.isElectric === true ||
      req.body.isElectric === "true",
    transmission: req.body.transmission || "auto",
  };
  await Car.updateOne({ _id: id, owner: req.session.userId }, { $set: update });
  res.redirect("/dashboard");
});

app.post("/cars/:id/delete", requireAuth, async (req, res) => {
  const { id } = req.params;
  await Car.deleteOne({ _id: id, owner: req.session.userId });
  res.redirect("/dashboard");
});


app.get("/api/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId)
    .select("-password")
    .lean();
  const cars = await Car.find({ owner: req.session.userId }).lean();
  res.json({ user, cars });
});


async function ensureLoggedInOrDemo(req, res, next) {
  if (!req.session.userId) {
    let demo = await User.findOne({ username: "demo" });
    if (!demo) {
      const hash = await bcrypt.hash("demo", 10);
      demo = await User.create({ username: "demo", password: hash });
    }
    req.session.userId = demo._id;
  }
  next();
}


app.get("/data", ensureLoggedInOrDemo, async (req, res) => {
  const cars = await Car.find({ owner: req.session.userId }).lean();
  res.json(cars);
});

app.post("/add", ensureLoggedInOrDemo, async (req, res) => {
  const b = req.body || {};

  // Validate inputs
  const allowedFuels = ["gasoline", "diesel", "electric", "hybrid"];
  const allowedTransmissions = ["auto", "manual"];

  if (!b.model || !b.year || !b.mpg) {
    return res.status(400).json({ error: "Model, year, and MPG are required fields." });
  }
  if (b.year < 1885) {
    return res.status(400).json({ error: "Year must be 1885 or later." });
  }
  if (!allowedFuels.includes(b.fuel)) {
    return res.status(400).json({ error: `Fuel must be one of: ${allowedFuels.join(", ")}.` });
  }
  if (!allowedTransmissions.includes(b.transmission)) {
    return res.status(400).json({ error: `Transmission must be one of: ${allowedTransmissions.join(", ")}.` });
  }

  const payload = {
    owner: req.session.userId,
    model: b.model.trim(),
    year: Number(b.year),
    mpg: Number(b.mpg),
    notes: b.notes?.trim() || "",
    fuel: b.fuel.trim(),
    isElectric: b.isElectric === "on" || b.isElectric === true,
    transmission: b.transmission.trim(),
  };

  try {
    await Car.create(payload);
    res.redirect("/dashboard"); // Redirect to the dashboard after adding a car
  } catch (err) {
    console.error("Error adding car:", err);
    res.status(500).json({ error: "Failed to add car." });
  }
});


app.post("/modify", ensureLoggedInOrDemo, async (req, res) => {
  const b = req.body || {};
  if (!b.id) return res.status(400).json({ error: "Missing id" });
  const update = {
    model: b.model,
    year: Number(b.year),
    mpg: Number(b.mpg),
    notes: b.notes,
    fuel: b.fuel,
    isElectric: b.isElectric === "on" || b.isElectric === true,
    transmission: b.transmission,
  };
  await Car.updateOne({ _id: b.id, owner: req.session.userId }, { $set: update });
  const cars = await Car.find({ owner: req.session.userId }).lean();
  res.json(cars);
});


app.post("/delete", ensureLoggedInOrDemo, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing id" });
  await Car.deleteOne({ _id: id, owner: req.session.userId });
  const cars = await Car.find({ owner: req.session.userId }).lean();
  res.json(cars);
});

app.use((req, res) => res.status(404).send("Not found"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
