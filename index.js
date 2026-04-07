const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();

app.use(cors());
app.use(express.json());

// 🔥 Firebase setup
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

// 🔥 MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rinnvkt.mongodb.net/parcelDB?retryWrites=true&w=majority&appName=Cluster0`;

// 🔥 Global DB variables
let db, userCollection, parcelCollection, paymentCollection, trackingCollection, riderCollection;

// 🔥 Connect DB (cached)
async function connectDB() {
    if (db) return;

    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });

    await client.connect();

    db = client.db('parcelDB');
    userCollection = db.collection('users');
    parcelCollection = db.collection('parcels');
    paymentCollection = db.collection('payments');
    trackingCollection = db.collection('trackings');
    riderCollection = db.collection('riders');
}

// 🔐 Middleware
const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send({ message: "Unauthorized access" });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).send({ message: "Unauthorized access" });

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
    } catch {
        return res.status(403).send({ message: "Forbidden access" });
    }
};

const verifyAdmin = async (req, res, next) => {
    await connectDB();
    const email = req.decoded.email;
    const user = await userCollection.findOne({ email });

    if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
    }
    next();
};

// ✅ ROOT
app.get('/', (req, res) => {
    res.send("Parcel Server is running");
});

// ✅ USERS
app.post('/users', async (req, res) => {
    await connectDB();

    const email = req.body.email;
    const userExists = await userCollection.findOne({ email });

    if (userExists) {
        await userCollection.updateOne(
            { email },
            { $set: { last_login: new Date() } }
        );
        return res.send({ message: 'User already exists', inserted: false });
    }

    const result = await userCollection.insertOne(req.body);
    res.send(result);
});

// ✅ PARCELS
app.get('/parcels', async (req, res) => {
    try {
        await connectDB();

        const parcels = await parcelCollection.find().toArray();
        res.send(parcels);
    } catch (error) {
        console.error(error);
        res.status(500).send("Failed to get parcels");
    }
});

app.post('/parcels', async (req, res) => {
    await connectDB();
    const result = await parcelCollection.insertOne(req.body);
    res.send(result);
});

app.get('/parcels/:id', async (req, res) => {
    await connectDB();

    const id = req.params.id;
    const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
    res.send(parcel);
});

app.delete('/parcels/:id', async (req, res) => {
    await connectDB();

    const result = await parcelCollection.deleteOne({
        _id: new ObjectId(req.params.id)
    });

    res.send(result);
});

// ✅ PAYMENTS
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { amountInCents } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: "bdt",
            payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });

    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

// ✅ EXPORT (Vercel)
module.exports = app;