CREATE TABLE IF NOT EXISTS departments (
  id INT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  icon VARCHAR(80) NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS doctors (
  id INT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  dept_id INT NOT NULL,
  room VARCHAR(30) NOT NULL,
  days VARCHAR(20) NOT NULL COMMENT 'working weekdays, Mon=0 e.g. 0,1,2,3,4',
  shift ENUM('am','pm','full') NOT NULL,
  start_hour TINYINT NULL COMMENT 'custom hours override the shift: first bookable hour (7-16)',
  end_hour TINYINT NULL COMMENT 'custom hours: end (exclusive, 8-17)',
  contact VARCHAR(40) NULL,
  specialization VARCHAR(120) NULL,
  on_duty TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_doctors_dept (dept_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('patient','doctor','admin') NOT NULL,
  username VARCHAR(190) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NULL,
  password_hash VARCHAR(100) NULL,
  google_sub VARCHAR(64) NULL,
  ref_id INT NULL COMMENT 'doctors.id for doctor accounts',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL DEFAULT NULL,
  consent_at TIMESTAMP NULL DEFAULT NULL,
  password_changed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'logins issued before this time stop working',
  active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = account disabled',
  UNIQUE KEY uq_users_role_username (role, username),
  UNIQUE KEY uq_users_google (google_sub),
  KEY idx_users_email (email)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  birthdate DATE NULL,
  sex CHAR(1) NULL,
  contact VARCHAR(40) NULL,
  blood_type VARCHAR(3) NULL,
  address VARCHAR(255) NULL,
  emergency_name VARCHAR(120) NULL,
  emergency_phone VARCHAR(40) NULL,
  family_history TEXT NULL,
  social_history TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_patients_name (name)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  doctor_id INT NULL,
  visit_date DATE NOT NULL,
  chief_complaint VARCHAR(255) NULL,
  history TEXT NULL COMMENT 'history of present illness',
  examination TEXT NULL,
  diagnosis VARCHAR(255) NOT NULL,
  plan TEXT NULL COMMENT 'plan / treatment',
  follow_up_date DATE NULL,
  appointment_id INT NULL,
  notes TEXT NULL,
  amended_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_visits_patient (patient_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ref VARCHAR(12) NOT NULL,
  user_id INT NULL,
  patient_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  dept_id INT NOT NULL,
  doctor_id INT NULL COMMENT 'set when the admin confirms',
  pref_doctor_id INT NULL COMMENT 'doctor chosen by the patient',
  appt_date DATE NOT NULL,
  appt_time CHAR(5) NOT NULL,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('pending','confirmed','serving','done','cancelled','no_show') NOT NULL DEFAULT 'pending',
  queue_no INT NULL,
  cancelled_by VARCHAR(12) NULL COMMENT 'patient, doctor, admin or system',
  checked_in_at TIMESTAMP NULL DEFAULT NULL,
  started_at TIMESTAMP NULL DEFAULT NULL COMMENT 'when the doctor called the patient (serving)',
  completed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'when the visit was marked done',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_appt_ref (ref),
  KEY idx_appt_doctor_slot (doctor_id, appt_date, appt_time),
  KEY idx_appt_pref_slot (pref_doctor_id, appt_date, appt_time),
  KEY idx_appt_date_status (appt_date, status),
  KEY idx_appt_user (user_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS facilities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('bed','equipment') NOT NULL,
  group_name VARCHAR(60) NOT NULL,
  name VARCHAR(80) NOT NULL,
  status ENUM('available','occupied','maintenance') NOT NULL DEFAULT 'available',
  KEY idx_fac_kind (kind, group_name)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS emails (
  id INT AUTO_INCREMENT PRIMARY KEY,
  to_addr VARCHAR(190) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  delivered TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  kind VARCHAR(30) NULL COMMENT 'confirmation, booking, ...',
  appointment_id INT NULL,
  html MEDIUMTEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP NULL DEFAULT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_emails_retry (delivered, attempts),
  KEY idx_emails_appt (appointment_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS doctor_leave (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL,
  leave_date DATE NOT NULL,
  reason VARCHAR(200) NOT NULL DEFAULT '',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_leave (doctor_id, leave_date)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  role VARCHAR(10) NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(30) NULL,
  entity_id INT NULL,
  detail VARCHAR(190) NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_time (created_at),
  KEY idx_audit_user (user_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 of the emailed token; the token itself is never stored',
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL DEFAULT NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reset_token (token_hash),
  KEY idx_reset_user (user_id, created_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS allergies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  substance VARCHAR(120) NOT NULL,
  reaction VARCHAR(255) NULL,
  severity ENUM('mild','moderate','severe') NOT NULL DEFAULT 'mild',
  notes VARCHAR(500) NULL,
  recorded_by INT NULL,
  entered_in_error TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'records are never deleted, only marked as entered in error',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_allergies_patient (patient_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conditions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active','chronic','resolved') NOT NULL DEFAULT 'active',
  since_date DATE NULL,
  notes VARCHAR(500) NULL,
  recorded_by INT NULL,
  entered_in_error TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_conditions_patient (patient_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS medications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  dose VARCHAR(80) NULL,
  frequency VARCHAR(80) NULL,
  start_date DATE NULL,
  end_date DATE NULL COMMENT 'empty = still taking it',
  notes VARCHAR(500) NULL,
  recorded_by INT NULL,
  entered_in_error TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_medications_patient (patient_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  visit_id INT NULL,
  recorded_by INT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bp_sys SMALLINT NULL,
  bp_dia SMALLINT NULL,
  heart_rate SMALLINT NULL,
  resp_rate SMALLINT NULL,
  temp_c DECIMAL(4,1) NULL,
  spo2 SMALLINT NULL,
  weight_kg DECIMAL(5,1) NULL,
  height_cm DECIMAL(5,1) NULL,
  bmi DECIMAL(4,1) NULL,
  notes VARCHAR(255) NULL,
  entered_in_error TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_vitals_patient (patient_id, recorded_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS visit_revisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visit_id INT NOT NULL,
  revised_by INT NULL,
  revised_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  snapshot TEXT NOT NULL COMMENT 'the visit note as it was BEFORE this amendment (JSON)',
  KEY idx_revisions_visit (visit_id)
) DEFAULT CHARSET=utf8mb4;
