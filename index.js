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
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rinnvkt.mongodb.net/?appName=Cluster0`;
// ✅ Fix it like this
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rinnvkt.mongodb.net/parcelDB?retryWrites=true&w=majority&appName=Cluster0`;



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
// const client = new MongoClient(uri, {
//     serverApi: {
//         version: ServerApiVersion.v1,
//         strict: true,
//         deprecationErrors: true,
//     }
// });
let cachedClient = null;

async function connectDB() {
    if (cachedClient) return cachedClient;

    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });

    await client.connect();
    cachedClient = client;
    return client;
}

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        const client = await connectDB();

        const db = client.db('parcelDB');
        const userCollection = db.collection('users');
        const parcelCollection = db.collection('parcels');
        const paymentCollection = db.collection('payments');
        const trackingCollection = db.collection('trackings');
        const riderCollection = db.collection('riders');

        // custom middlewares
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: "Unauthorized access" });
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: "Unauthorized access" });
            }

            //verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            } catch (error) {
                return res.status(403).send({ message: "Forbidden access" });
            }
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await userCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await userCollection.findOne({ email });
            if (userExists) {
                // update last login time
                await userCollection.updateOne(
                    { email: email },
                    {
                        $set: {
                            last_login: new Date()
                        }
                    }
                );
                return res.status(200).send({ message: 'User already exists', inserted: false });
            }
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // search user by email
        app.get("/users/search", async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.send([]);
            }
            const query = {
                email: { $regex: email, $options: "i" }
            };
            const users = await userCollection.find(query).limit(10).toArray();
            res.send(users);
        });

        // search user by role(admin)
        app.get("/users/:email/role", async (req, res) => {
            try {
                const email = req.params.email;
                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }
                const user = await userCollection.findOne({ email });
                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }
                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role', error);
                return res.status(500).send({ message: 'Failed to get role' });
            }
        });

        // change user role
        app.patch("/users/:id/role", verifyFBToken, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const { role } = req.body;

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { role }
                }
            );

            res.send(result);
        });

        // parcels api
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const userEmail = req.query.email;
                const query = userEmail ? { user_email: userEmail } : {};
                const options = {
                    sort: { creation_timestamp: -1 },
                };
                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to get parcels' });
            }
        });

        // get parcels that are status paid and delivery status not collected
        app.get("/parcels/assignable", async (req, res) => {

            const query = {
                delivery_status: "not_collected",
                payment_status: "paid"
            };

            const parcels = await parcelCollection.find(query).toArray();

            res.send(parcels);
        });

        // get a specific parcel by ID
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid parcel ID" });
                }
                const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
                if (!parcel) {
                    return res.status(404).send({ message: "Parcel not found" });
                }
                res.send(parcel);
            } catch (error) {
                console.error("Error fetching parcel:", error);
                res.status(500).send({ message: "Failed to fetch parcel" });
            }
        })

        // post new parcel
        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = req.body;
                const result = await parcelCollection.insertOne(newParcel);
                res.status(201).send(result);
            } catch (error) {
                console.error("Error inserting parcel", error);
                res.status(500).send({ message: "Failed to create parcel" });
            }
        });

        // delete parcel by id
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await parcelCollection.deleteOne(query);
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Parcel not found" });
                }

                res.send({ message: "Parcel deleted successfully", result });
            } catch (error) {
                console.error("Error deleting parcel:", error);
                res.status(500).send({ message: "Failed to delete parcel" });
            }
        });

        // Tracking related API
        app.post("/tracking", async (req, res) => {
            const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;
            const log = {
                tracking_id,
                parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
                status,
                message,
                time: new Date(),
                updated_by,
            };
            const result = await trackingCollection.insertOne(log);
            res.send({ success: true, insertedId: result.insertedId })
        });

        // rider get api who are status pending
        app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await riderCollection.find({ status: "pending" }).toArray();
                res.send(pendingRiders)
            } catch (error) {
                console.error("Failed to load pending riders:", error);
                res.status(500).send({ message: "Failed to load pending riders" });
            }
        })
        // rider get api who are status active
        app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
            const query = { status: "active" };
            const riders = await riderCollection.find(query).toArray();
            res.send(riders);
        });

        // rider post api
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await riderCollection.insertOne(rider);
            res.send(result);
        })

        // update rider status (approve / reject)
        app.patch('/riders/:id/status', async (req, res) => {
            try {
                const id = req.params.id;
                const { status, email } = req.body;
                const result = await riderCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: { status }
                    }
                );

                // update user role for accepting rider
                if (status === 'active') {
                    const userQuery = { email };
                    const userUpdateDoc = {
                        $set: {
                            role: 'rider'
                        }
                    };
                    const roleResut = await userCollection.updateOne(userQuery, userUpdateDoc)
                }
                res.send(result);
            } catch (error) {
                console.error("Failed to update rider status:", error);
                res.status(500).send({ message: "Failed to update rider status" });
            }
        });


        // payment api
        app.post('/create-payment-intent', async (req, res) => {
            try {
                const { amountInCents } = req.body;
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: "bdt",
                    payment_method_types: ["card"],
                });
                res.send({
                    clientSecret: paymentIntent.client_secret
                });

            } catch (error) {
                res.status(500).send({ error: error.message });
            }
        });

        // get payments history
        app.get('/payments', verifyFBToken, async (req, res) => {
            try {
                const userEmail = req.query.email;
                if (req.decoded.email !== userEmail) {
                    return res.status(403).send({ message: "Forbidden access" });
                }
                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paid_at: -1 } };

                const payments = await paymentCollection.find(query, options).toArray();
                res.send(payments);
            } catch (error) {
                console.error('Error fetching Payment processing failed history:', error);
                res.status(500).send({ message: "Failed to get payments" });
            }
        });

        // record payment and update parcel status
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, amount, paymentMethod, transactionId } = req.body;
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    { $set: { payment_status: "paid" } }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: "Parcel not found or already paid" });
                }

                const paymentDoc = {
                    parcelId,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date()
                };

                const paymentResult = await paymentCollection.insertOne(paymentDoc);

                res.send({
                    insertedId: paymentResult.insertedId
                });

            } catch (error) {
                console.error("Payment processing failed", error);
                res.status(500).send({ message: "Payment failed" });
            }
        });


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
// run().catch(console.dir);
run().catch(err => {
    console.error("🔥 Run function error:", err);
});




app.get('/', (req, res) => {
    res.send("Parcel Server is running");
})

// app.listen(port, () => {
//     console.log(`Server is listening on port ${port}`);
// })
module.exports = app;