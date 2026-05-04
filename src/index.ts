import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import { rateLimit } from 'express-rate-limit';
import { configurePassport } from './modules/auth/infrastructure/PassportConfig';
import authRoutes from './modules/auth/infrastructure/AuthRoutes';
import userRoutes from './modules/users/infrastructure/UserRoutes';
import adminRoutes from './modules/admins/infrastructure/AdminRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

app.use(helmet());
app.use(limiter);
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Session & Passport
app.set('trust proxy', 1); // Trust the dev tunnel proxy
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.BACKEND_URL?.startsWith('https'), // Secure cookies if using HTTPS
      sameSite: 'lax',
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admins', adminRoutes);

import { errorHandler } from './shared/infrastructure/middlewares/errorHandler';
app.use(errorHandler);

app.get('/', (req, res) => {
  res.json({ 
    message: 'Server is running', 
    architecture: 'Clean + Screaming',
    modules: ['users', 'admins']
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
