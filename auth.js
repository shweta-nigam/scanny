import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

const mongoUri = process.env.MONGODB_URI || process.env.MONOGO_URI;
let db = null;
let client = null;

if (mongoUri) {
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db("product_scanner");
    console.log("Connected to MongoDB for Better Auth");
  } catch (err) {
    console.warn("MongoDB connection warning:", err.message);
  }
}

export const auth = betterAuth({
  database: db ? mongodbAdapter(db, { client }) : undefined,
  secret: process.env.BETTER_AUTH_SECRET || "scanny_secret_auth_key_super_secure_32chars_2026",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "YOUR_GOOGLE_CLIENT_SECRET",
      prompt: "select_account"
    }
  },
  emailAndPassword: {
    enabled: true
  }
});
