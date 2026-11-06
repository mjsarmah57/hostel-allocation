// A student may live only in a hostel of their gender that admits their year.
function isEligible(student, hostel) {
  return student.gender === hostel.gender && hostel.allowedYears.includes(Number(student.year));
}

module.exports = { isEligible };
