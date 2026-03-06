const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rinnvkt.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('parcelDB');
        const parcelCollection = db.collection('parcels');
        const paymentCollection = db.collection('payments');

        // get all parcels
        // app.get('/parcels', async (req, res) => {
        //     const parcels = await parcelCollection.find().toArray();
        //     res.send(parcels);
        // })

        // parcels api
        app.get('/parcels', async (req, res) => {
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


        // payment api
        app.get('/create-payment-intent', async (req, res) => {
            const amountIncents = req.body.amountInCents;
            try {
                const paymentIntent = await stripe.paymentIntent.create({
                    amount: amountIncents,
                    currency: "bdt",
                    payment_method_types: ["card"],
                });

                res.json({ clientSecret: paymentIntent.client_secret })
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // record payment and update parcel status
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, paymentMehtod, transactionId } = req.body;

                const updateResult = await parcelCollection.updateOne({
                    _id: new ObjectId(parcelId)
                },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    });
                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: "Parcel not found or already paid" });
                }

                const paymentDoc = {
                    parcelId,
                    email,
                    amount,
                    paymentMehtod,
                    transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date(),
                };

                const paymentResult = await paymentCollection.insertOne(paymentDoc);

                res.status(201).send({
                    message: "Payment recorded and parcel marked as paid",
                    insertedId: paymentResult.insertedId
                });

            } catch (error) {
                console.error("Payment processing failed", error)
            }
        })





        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send("Parcel Server is running");
})

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
})