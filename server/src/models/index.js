// Sequelize models mapped onto the tables created by db/migrations/*.sql.
// The schema is owned by the SQL migrations (partial indexes, CHECKs, enums),
// so sequelize.sync() is never called.
const { DataTypes } = require('sequelize');
const sequelize = require('../lib/db');

const ACTIVE_STATUSES = ['ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN'];

const Role = sequelize.define('roles', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
});

const Permission = sequelize.define('permissions', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING, allowNull: false },
});

const RolePermission = sequelize.define('role_permissions', {
  roleId: { type: DataTypes.INTEGER, primaryKey: true },
  permissionId: { type: DataTypes.INTEGER, primaryKey: true },
});

const User = sequelize.define('users', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING, allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  roleId: { type: DataTypes.INTEGER, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const RefreshToken = sequelize.define('refresh_tokens', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  tokenHash: { type: DataTypes.STRING, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  revokedAt: DataTypes.DATE,
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const Student = sequelize.define('students', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  rollNo: { type: DataTypes.STRING, allowNull: false },
  gender: { type: DataTypes.ENUM('MALE', 'FEMALE'), allowNull: false },
  year: { type: DataTypes.INTEGER, allowNull: false },
  program: { type: DataTypes.STRING, allowNull: false },
  cgpa: { type: DataTypes.DECIMAL(4, 2), allowNull: false },
  isPwd: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Hostel = sequelize.define('hostels', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false },
  gender: { type: DataTypes.ENUM('MALE', 'FEMALE'), allowNull: false },
  allowedYears: { type: DataTypes.ARRAY(DataTypes.INTEGER), allowNull: false },
  wardenId: DataTypes.INTEGER,
});

const Room = sequelize.define('rooms', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hostelId: { type: DataTypes.INTEGER, allowNull: false },
  roomNo: { type: DataTypes.STRING, allowNull: false },
  floor: { type: DataTypes.INTEGER, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false },
});

const Bed = sequelize.define('beds', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  roomId: { type: DataTypes.INTEGER, allowNull: false },
  label: { type: DataTypes.STRING, allowNull: false },
});

const AllocationRound = sequelize.define('allocation_rounds', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  status: {
    type: DataTypes.ENUM('DRAFT', 'PREFERENCES_OPEN', 'ALLOCATED', 'BOOKING_OPEN', 'CLOSED'),
    defaultValue: 'DRAFT',
  },
  feeWindowDays: { type: DataTypes.INTEGER, defaultValue: 7 },
  allocatedAt: DataTypes.DATE,
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const Preference = sequelize.define('preferences', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  roundId: { type: DataTypes.INTEGER, allowNull: false },
  studentId: { type: DataTypes.INTEGER, allowNull: false },
  roomId: { type: DataTypes.INTEGER, allowNull: false },
  rank: { type: DataTypes.INTEGER, allowNull: false },
});

const Allocation = sequelize.define('allocations', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session: { type: DataTypes.STRING, allowNull: false },
  studentId: { type: DataTypes.INTEGER, allowNull: false },
  bedId: { type: DataTypes.INTEGER, allowNull: false },
  roundId: DataTypes.INTEGER,
  status: {
    type: DataTypes.ENUM('ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN', 'VACATED', 'RELEASED', 'SWAPPED'),
    defaultValue: 'ALLOCATED',
  },
  source: { type: DataTypes.ENUM('PRIORITY', 'OPEN_BOOKING', 'SWAP', 'LEGACY'), allowNull: false },
  feeDueAt: DataTypes.DATE,
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const SwapRequest = sequelize.define('swap_requests', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session: { type: DataTypes.STRING, allowNull: false },
  requesterAllocId: { type: DataTypes.INTEGER, allowNull: false },
  targetAllocId: { type: DataTypes.INTEGER, allowNull: false },
  status: {
    type: DataTypes.ENUM('PENDING_PEER', 'PENDING_WARDEN', 'APPROVED', 'REJECTED', 'CANCELLED'),
    defaultValue: 'PENDING_PEER',
  },
  decidedAt: DataTypes.DATE,
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
});

const FeeReceipt = sequelize.define('fee_receipts', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  allocationId: { type: DataTypes.INTEGER, allowNull: false },
  filePath: { type: DataTypes.STRING, allowNull: false },
  originalName: { type: DataTypes.STRING, allowNull: false },
  mimeType: { type: DataTypes.STRING, allowNull: false },
  sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
  uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  verifiedBy: DataTypes.INTEGER,
  verifiedAt: DataTypes.DATE,
});

// ---------- Associations ----------
Role.hasMany(User, { foreignKey: 'roleId' });
User.belongsTo(Role, { foreignKey: 'roleId' });
Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'roleId', otherKey: 'permissionId' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permissionId', otherKey: 'roleId' });
User.hasOne(Student, { foreignKey: 'userId' });
Student.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Hostel, { foreignKey: 'wardenId', as: 'wardenOf' });
Hostel.belongsTo(User, { foreignKey: 'wardenId', as: 'warden' });
Hostel.hasMany(Room, { foreignKey: 'hostelId' });
Room.belongsTo(Hostel, { foreignKey: 'hostelId' });
Room.hasMany(Bed, { foreignKey: 'roomId' });
Bed.belongsTo(Room, { foreignKey: 'roomId' });
Student.hasMany(Allocation, { foreignKey: 'studentId' });
Allocation.belongsTo(Student, { foreignKey: 'studentId' });
Bed.hasMany(Allocation, { foreignKey: 'bedId' });
Allocation.belongsTo(Bed, { foreignKey: 'bedId' });
Allocation.hasMany(FeeReceipt, { foreignKey: 'allocationId' });
FeeReceipt.belongsTo(Allocation, { foreignKey: 'allocationId' });
Preference.belongsTo(Room, { foreignKey: 'roomId' });
SwapRequest.belongsTo(Allocation, { foreignKey: 'requesterAllocId', as: 'requester' });
SwapRequest.belongsTo(Allocation, { foreignKey: 'targetAllocId', as: 'target' });

module.exports = {
  sequelize,
  ACTIVE_STATUSES,
  Role,
  Permission,
  RolePermission,
  User,
  RefreshToken,
  Student,
  Hostel,
  Room,
  Bed,
  AllocationRound,
  Preference,
  Allocation,
  SwapRequest,
  FeeReceipt,
};
