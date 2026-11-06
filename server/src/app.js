const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const env = require('./config/env');
const logger = require('./lib/logger');
const requestId = require('./middleware/requestId');
const authenticate = require('./middleware/authenticate');
const { apiLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const openapi = require('./docs/openapi');

const authRoutes = require('./modules/auth/auth.routes');
const hostelRoutes = require('./modules/hostels/hostels.routes');
const roundRoutes = require('./modules/rounds/rounds.routes');
const allocationRoutes = require('./modules/allocations/allocations.routes');
const swapRoutes = require('./modules/swaps/swaps.routes');
const reportRoutes = require('./modules/reports/reports.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const userRoutes = require('./modules/users/users.routes');
const studentRoutes = require('./modules/students/students.routes');
const roomRoutes = require('./modules/rooms/rooms.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const complaintRoutes = require('./modules/complaints/complaints.routes');

const app = express();
app.set('trust proxy', 1); // behind Render/Railway's proxy: needed for rate limiting by real IP

app.use(requestId);
app.use(pinoHttp({ logger, genReqId: (req) => req.id, customProps: (req) => ({ userId: req.user?.id }) }));
app.use(helmet());
app.use(
  cors({
    // Deliberate allow-list. credentials:true is required for the httpOnly refresh cookie.
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Location'],
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Hostel Allocation API' }));
app.get('/api/openapi.json', (req, res) => res.json(openapi));

const v1 = express.Router();
v1.use(apiLimiter);
v1.use('/auth', authRoutes);
v1.use(authenticate); // everything below requires a valid access token
v1.use('/hostels', hostelRoutes);
v1.use('/rounds', roundRoutes);
v1.use('/allocations', allocationRoutes);
v1.use('/swaps', swapRoutes);
v1.use('/reports', reportRoutes);
v1.use('/admin', adminRoutes);
v1.use('/users', userRoutes);
v1.use('/students', studentRoutes);
v1.use('/rooms', roomRoutes);
v1.use('/dashboard', dashboardRoutes);
v1.use('/complaints', complaintRoutes);
v1.use('/notifications', adminRoutes.notificationsRouter);
app.use('/api/v1', v1);

// Production: serve the built React client from the same origin as the API.
// One URL, no cross-site cookies, and SPA routes fall back to index.html.
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|health$).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
