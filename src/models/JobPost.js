const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * models/JobPost.js
 * -------------------
 * The "billboard" side of the marketplace: instead of a freelancer
 * listing what they offer and waiting to be found, a customer posts
 * what they NEED, and freelancers browse for work. Same underlying
 * idea as Entrepreneur (one document, embedded sub-data) for the same
 * reason — a job post's responses are only ever read alongside the post
 * itself, never queried globally, so they're embedded rather than a
 * separate collection.
 */

// Someone expressing interest in a job — kept lightweight on purpose.
// This isn't a full chat thread, just enough for the poster to see who
// wants the work and reach out to whichever one they pick.
const JobResponseSchema = new Schema({
  telegramId: { type: Number, required: true },
  name: { type: String, required: true },
  message: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

const JobPostSchema = new Schema({
  posterTelegramId: { type: Number, required: true, index: true },
  posterName: { type: String, required: true },
  posterUsername: String, // lets a responder deep-link to t.me/<username> without another lookup

  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, default: "" }, // optional match against the existing categories collection
  budget: { type: Number, default: null },
  budgetType: { type: String, enum: ["fixed", "hourly", "negotiable"], default: "negotiable" },

  location: {
    lat: Number,
    lng: Number,
    address: String,
  },
  // When true, this job only shows to freelancers within RADIUS_KM of
  // `location` (and only if THEY'VE shared their own location too — no
  // location on either side means no way to confirm proximity, so the
  // job simply doesn't show rather than guessing). When false, the job
  // shows in the general feed regardless of anyone's location — the
  // right default for remote/social-media-friendly work.
  requiresOnSite: { type: Boolean, default: false },

  // "open" = visible on the board and accepting responses. "fulfilled" =
  // the poster found someone and closed it themselves. "closed" = poster
  // took it down without necessarily filling it. Both non-open states
  // stay in the database (nothing is deleted just by closing it) but
  // drop out of the browsable feed.
  status: { type: String, enum: ["open", "fulfilled", "closed"], default: "open" },
  suspended: { type: Boolean, default: false }, // admin moderation, same pattern as Entrepreneur.suspended

  responses: { type: [JobResponseSchema], default: [] },

  createdAt: { type: Date, default: Date.now },
});

JobPostSchema.index({ title: "text", description: "text" });

module.exports = mongoose.model("JobPost", JobPostSchema);
