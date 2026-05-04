import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
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

// Routes
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
