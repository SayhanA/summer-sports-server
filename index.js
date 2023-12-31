const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const app = express()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;
const uri = `mongodb+srv://${process.env.S3_BUCKET}:${process.env.SECRET_KEY}@cluster0.u2hpa9s.mongodb.net/?retryWrites=true&w=majority`;


app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401 - 1).send({ error: true, message: 'unauthorized access header is empty' });
    }

    // if user send a token in header
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        }

        req.decoded = decoded;
        next();

    })

}


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
        // await client.connect();

        // const classesCollection = client.db('summerPlay').collection('classes')
        const usersCollection = client.db('summerPlay').collection('users')
        const classesCollection = client.db('summerPlay').collection('classes')
        const instructorsCollection = client.db('summerPlay').collection('instructors')
        const reviewsCollection = client.db('summerPlay').collection('reviews')
        const cartCollection = client.db('summerPlay').collection('carts')
        const paymentCollection = client.db('summerPlay').collection('payments')


        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

            res.send({ token })
        })

        // Use VerifyAdmin after VerifyJWT token
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access user is not admin' })
            }
            next();
        }

        // TODO: Create user VerifyInstructor and use if after VerifyJWT token

        // users related api
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            // console.log(user);
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exist' })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })


        // Checking user is admin or not
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.send({ admin: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query);
            
            const result = { admin: user?.role === "admin" }
            res.send(result)

        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const role = req.query.role;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: role
                },
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        })


        // Verify Instructor middleware
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.send({ admin: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === "instructor" }
            res.send(result)

        })

        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })

        // Classes Data
        app.get('/classes/all', async (req, res) => {
            const query = { status: "approve" }
            const result = await classesCollection.find(query).sort({ availableSeats: 1 }).toArray();
            res.send(result)
        })
        app.get('/classes', async (req, res) => {
            try {
                const result = await classesCollection.find().sort({ date: -1 }).toArray();
                res.send(result)
            }
            catch (error) {

            }
        })

        app.get('/classes/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await classesCollection.find(query).sort({ date: -1 }).toArray()
            res.send(result)
        })

        // TODO: Create Verify instructor midfdleware 
        app.post('/classes', async (req, res) => {
            const newClass = req.body;
            const result = await classesCollection.insertOne(newClass)
            res.send(result)
        })

        app.patch('/classes/admin/:id', async (req, res) => {
            const id = req.params.id;
            const status = req.query.role;
            const feedback = req.query.data;

            if (feedback) {
                console.log(feedback)
                const filter = { _id: new ObjectId(id) };
                console.log(filter)
                const updateDoc = {
                    $set: {
                        status: status,
                        feedback: feedback
                    },
                };

                const result = await classesCollection.updateOne(filter, updateDoc);
                return res.send(result)
            }

            console.log("classes admin panel", id, status)

            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: status,
                },
            };

            const result = await classesCollection.updateOne(filter, updateDoc);
            res.send(result)
        })

        app.delete('/classes/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await classesCollection.deleteOne(query);
            res.send(result);
        })

        // Create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                ClientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payment', verifyJWT, async (req, res) => {
            const payment = req.body;
            // console.log(payment);
            // const { _id } = payment;
            const insertResult = await paymentCollection.insertOne(payment)

            const query = { _id: new ObjectId(payment.id) }
            const deleteResult = await cartCollection.deleteOne(query)

            // update available seats
            const filter = { _id: new ObjectId(payment.classId) }
            console.log(filter)
            const update = { $set: { availableSeats: parseInt(payment.availableSeats) - 1 } };
            console.log(update)
            const UpdateResult = await classesCollection.updateOne(filter, update);
            console.log(UpdateResult)

            res.send({ insertResult, deleteResult, UpdateResult })
        })

        app.get('/payment/history/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await paymentCollection.find(query).sort({ data: -1 }).toArray();
            res.send(result)
        })

        app.get('/payment', async(req, res) => {
            const result = await paymentCollection.find().toArray()
            res.send(result)
        })

        // Instructor Data
        app.get('/instructor', async (req, res) => {
            try {
                const result = await instructorsCollection.find().sort({ availableSeats: 1 }).toArray();
                res.send(result)
            }
            catch (error) {

            }
        })

        app.get('/instructor/:name', async (req, res) => {
            try {
                const name = req.params.name;
                const query = { instructor: name };
                const result = await classesCollection.find(query).toArray();
                res.send(result)
            }
            catch (error) {
                console.log(error)
            }
        })

        // Reviews Data
        app.get('/reviews', async (req, res) => {
            try {
                const result = await reviewsCollection.find().sort({ availableSeats: 1 }).toArray();
                res.send(result)
            }
            catch (error) {

            }
        })


        // cart collection apis
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            console.log(email)
            if (!email) {
                return res.send([]);
            }

            const decodedEmail = req.decoded.email;
            console.log(decodedEmail);
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'Forbidden Access' });
            }

            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result)
        })

        app.post('/carts', async (req, res) => {
            const item = req.body;
            console.log(item);
            const result = await cartCollection.insertOne(item);
            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result)
        })

        // Admin
        app.get('/admin-stats', async( req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const classes = await classesCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce( (sum, entry) => sum + entry.price ,0)

            res.send({
                users,
                classes,
                orders,
                revenue,
            })
        })
        

        
        

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close?();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send("Welcome to the server")
})

app.listen(port, () => {
    console.log(`Your server is running on PORT: ${port}`)
})



// https://b7a12-summer-camp-server-side-sayhan-a.vercel.app