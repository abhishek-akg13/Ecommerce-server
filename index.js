require('dotenv').config();
const express = require('express');
const connectDB  = require('./config/db');
const app = express();
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const productsRouter = require('./routes/Products');
const categoriesRouter = require('./routes/Categories');
const brandsRouter = require('./routes/Brands');
const usersRouter = require('./routes/Users');
const authRouter = require('./routes/Auth');
const cartRouter = require('./routes/Cart');
const ordersRouter = require('./routes/Order');
const { User } = require('./model/User');
const path = require('path');
const { isAuth, sanitizeUser ,cookieExtractor} = require('./services/common');

// Create a new instance of MongoDBStore
const store = new MongoDBStore({
  uri: process.env.MONGODB_URL, // Replace with your MongoDB connection string
  collection: 'sessions',
  expires: 1000 * 60 * 60 * 24 * 7, // Set session to expire in 7 days (adjust as needed)
});

// Handle MongoDB connection error
store.on('error', function (error) {
  console.error('MongoDB session store error:', error);
});

// Webhook

// TODO: we will capture actual order after deploying out server live on public URL

const endpointSecret = process.env.WEBHOOK_ENDPOINT;

// where to run stripe cli (folderwhere stripe.exe downloaded in path type cmd.exe ->stripe.exe->stripe login)

app.post('/webhook', express.raw({type: 'application/json'}), async(request, response) => {
  console.log("inside webhook",request.body);
  const sig = request.headers['stripe-signature'];

  let event;

  try {
    event = await stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
  } catch (err) {
    response.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntentSucceeded = event.data.object;
      console.log({paymentIntentSucceeded})
      // Then define and call a function to handle the event payment_intent.succeeded
      break;
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  response.send();
});


// JWT options
const opts = {};
opts.jwtFromRequest = cookieExtractor;
opts.secretOrKey = process.env.JWT_SECRET_KEY; // TODO: should not be in code;

//middlewares
app.use(express.static(path.resolve(__dirname,'build')))
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_KEY,
    resave: false, // don't save session if unmodified
    saveUninitialized: false, // don't create session until something stored
  })
);
app.use(passport.authenticate('session'));
app.use(
  cors({
    exposedHeaders: ['X-Total-Count'],
  })
);
app.use(express.json()); // to parse req.body
app.use('/products', isAuth(), productsRouter.router);
// we can also use JWT token for client-only auth
app.use('/categories', isAuth(), categoriesRouter.router);
app.use('/brands', isAuth(), brandsRouter.router);
app.use('/users', isAuth(), usersRouter.router);

app.use('/auth', authRouter.router);
app.use('/cart', isAuth(), cartRouter.router);
app.use('/orders', isAuth(), ordersRouter.router);

// this line we add to make react router work in case of other routes doesnt match
app.get('*', (req, res) => res.sendFile(path.resolve('build', 'index.html')));

// Passport Strategies
passport.use(
    'local',
    new LocalStrategy(
      {usernameField:'email'},
      async function (email, password, done) {
      // by default passport uses username
      // console.log({email,password})
      try {
        const user = await User.findOne({ email: email });
        // console.log(email, password, user);
        if (!user) {
          return done(null, false, { message: 'invalid credentials' }); // for safety
        }
        crypto.pbkdf2(
          password,
          user.salt,
          310000,
          32,
          'sha256',
          async function (err, hashedPassword) {
            if (!crypto.timingSafeEqual(user.password, hashedPassword)) {
              return done(null, false, { message: 'invalid credentials' });
            }
            const token = jwt.sign(sanitizeUser(user),process.env.JWT_SECRET_KEY);
            done(null, {id:user.id, role:user.role,token:token}); // this lines sends to serializer
          }
        );
      } catch (err) {
        done(err);
      }
    })
  );

passport.use(
  'jwt',
  new JwtStrategy(opts, async function (jwt_payload, done) {
    console.log({ jwt_payload });
    try {
        const user = await User.findById(jwt_payload.id);
      if (user) {
        return done(null, sanitizeUser(user)); // this calls serializer
      } else {
        return done(null, false);
      }
    } catch (err) {
      return done(err, false);
    }
  })
);

// this creates session variable req.user on being called from callbacks
passport.serializeUser(function (user, cb) {
  console.log('serialize', user);
  process.nextTick(function () {
    return cb(null, { id: user.id, role: user.role });
  });
});

// this changes session variable req.user when called from authorized request

passport.deserializeUser(function (user, cb) {
  console.log('de-serialize', user);
  process.nextTick(function () {
    return cb(null, user);
  });
});

// Payments


// This is your test secret API key.
const stripe = require("stripe")(process.env.STRIPE_SERVER_KEY);


app.post("/create-payment-intent", async (req, res) => {
  const { totalAmount, orderId } = req.body;
  console.log("payment-intent",totalAmount);

  // Create a PaymentIntent with the order amount and currency
  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalAmount*100, // for decimal compensation
    currency: "inr",
    automatic_payment_methods: {
      enabled: true,
    },
    metadata:{
      orderId
    }
  });

  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});




// https://www.youtube.com/watch?v=LH-S5v-D3hA
app.listen(process.env.PORT, async()=>{
    connectDB();
    console.log('server started on PORT',process.env.PORT)
})