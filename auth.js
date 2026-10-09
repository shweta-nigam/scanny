import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";
import { mongodbAdapter } from "better-auth/adapters/mongodb";



const mongoUri = process.env.MONGODB_URI || process.env.MONOGO_URI;
let db = null;
let client = null;

if (mongoUri) {
  try {
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 2500,
      connectTimeoutMS: 2500,
    });
    client.connect().then(() => {
      db = client.db("product_scanner");
      console.log("Connected to MongoDB for Better Auth");
    }).catch((err) => {
      console.warn("MongoDB async connection warning:", err?.message || err);
    });
  } catch (err) {
    console.warn("MongoDB init error:", err.message);
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID ;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ;

export const auth = betterAuth({
  database: db ? mongodbAdapter(db, { client }) : undefined,
  secret: process.env.BETTER_AUTH_SECRET || "scanny_secret_auth_key_super_secure_32chars_2026",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.BETTER_AUTH_URL
  ].filter(Boolean),
  socialProviders: {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      prompt: "select_account",
      accessType: "offline"
    }
  },
  emailAndPassword: {
    enabled: true
  }
});


