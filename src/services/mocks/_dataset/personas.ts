import { buildCedula } from './cedula';

export interface Employment {
  employer: string;
  salary: number; // USD per month declared at IESS
  monthsActive: number; // months of continuous active affiliation
}

export interface AltScore {
  score: number; // [0, 100] — synthetic from spending patterns / digital footprint
  signals: string[]; // non-empty list of qualitative tags driving the score
}

export interface Persona {
  cedula: string;
  name: string;
  birthDate: string; // ISO YYYY-MM-DD
  deathDate?: string; // ISO YYYY-MM-DD if fallecida
  employment?: Employment; // absent ⇒ autónomo / no afiliado al IESS
  equifaxBaseScore: number; // [350, 820] — score before any hard inquiry. Required.
  altScore?: AltScore; // absent ⇒ no digital footprint coverage (sin_data path)
}

/**
 * Generates a valid cedula deterministically from an index. Provincia rotates
 * 01-24, third digit rotates 0-5, last 6 digits are the sequential bucket.
 */
function makeCedula(index: number): string {
  const provincia = (1 + (index % 24)).toString().padStart(2, '0');
  const third = (index % 6).toString();
  const seq = Math.floor(index / 6)
    .toString()
    .padStart(6, '0');
  return buildCedula(provincia + third + seq);
}

// 40 vivos + 5 fallecidos. Names mix common Ecuadorian first/last names.
// Indices 0-34 are afiliados al IESS (employer + salary + monthsActive).
// Indices 35-39 are autónomos (no employment record → IESS sin_afiliacion).
// Indices 40-44 are fallecidos (no employment, fail at identity).
// Score distribution: 13 alto (≥750), 18 medio (650-749), 9 bajo (500-649), 5 muy bajo (<500).
type Entry = {
  name: string;
  birthDate: string;
  deathDate?: string;
  employment?: Employment;
  equifaxBaseScore: number;
  altScore?: AltScore;
};

const ENTRIES: Entry[] = [
  // ---- vivos afiliados (35) ----
  { name: 'Maria Lopez Vargas', birthDate: '1985-04-12', equifaxBaseScore: 720, employment: { employer: 'Banco Pichincha', salary: 1450, monthsActive: 84 }, altScore: { score: 78, signals: ['stable_spending', 'no_chargebacks', 'long_account_history'] } },
  { name: 'Juan Perez Castillo', birthDate: '1978-07-23', equifaxBaseScore: 700, employment: { employer: 'Empresa Eléctrica Quito', salary: 1280, monthsActive: 156 }, altScore: { score: 72, signals: ['stable_spending', 'utility_payer', 'long_account_history'] } },
  { name: 'Ana Rodriguez Mora', birthDate: '1992-11-05', equifaxBaseScore: 660, employment: { employer: 'Corporación La Favorita', salary: 920, monthsActive: 42 }, altScore: { score: 64, signals: ['regular_income', 'moderate_spending'] } },
  { name: 'Carlos Andrade Suarez', birthDate: '1980-02-18', equifaxBaseScore: 740, employment: { employer: 'Cervecería Nacional', salary: 1620, monthsActive: 120 }, altScore: { score: 81, signals: ['high_digital_footprint', 'early_payments', 'no_chargebacks'] } },
  { name: 'Sofia Cevallos Ortiz', birthDate: '1995-09-30', equifaxBaseScore: 660, employment: { employer: 'Pronaca', salary: 780, monthsActive: 28 }, altScore: { score: 58, signals: ['young_account', 'regular_income'] } },
  { name: 'Luis Gomez Paredes', birthDate: '1973-06-14', equifaxBaseScore: 800, employment: { employer: 'Banco Guayaquil', salary: 2150, monthsActive: 192 }, altScore: { score: 92, signals: ['high_digital_footprint', 'no_chargebacks', 'long_account_history', 'early_payments'] } },
  { name: 'Patricia Vega Romero', birthDate: '1988-12-22', equifaxBaseScore: 710, employment: { employer: 'Holcim', salary: 1340, monthsActive: 96 }, altScore: { score: 74, signals: ['stable_spending', 'utility_payer'] } },
  { name: 'Diego Bustamante Cruz', birthDate: '1990-03-08', equifaxBaseScore: 680, employment: { employer: 'Diners Club', salary: 1180, monthsActive: 72 }, altScore: { score: 68, signals: ['frequent_traveler', 'moderate_spending'] } },
  { name: 'Veronica Naranjo Reyes', birthDate: '1982-08-17', equifaxBaseScore: 750, employment: { employer: 'Conecel - Claro', salary: 1560, monthsActive: 132 }, altScore: { score: 82, signals: ['stable_spending', 'high_digital_footprint', 'no_chargebacks'] } },
  { name: 'Andres Tapia Cordero', birthDate: '1996-01-25', equifaxBaseScore: 580, employment: { employer: 'Movistar', salary: 850, monthsActive: 24 }, altScore: { score: 48, signals: ['young_account', 'high_volatility'] } },
  { name: 'Fernanda Espinoza Lara', birthDate: '1987-05-11', equifaxBaseScore: 720, employment: { employer: 'Banco Bolivariano', salary: 1390, monthsActive: 108 }, altScore: { score: 76, signals: ['stable_spending', 'utility_payer', 'no_chargebacks'] } },
  { name: 'Roberto Alvarez Pinto', birthDate: '1975-10-03', equifaxBaseScore: 810, employment: { employer: 'OCP Ecuador', salary: 2480, monthsActive: 168 }, altScore: { score: 94, signals: ['high_digital_footprint', 'early_payments', 'long_account_history', 'no_chargebacks'] } },
  { name: 'Daniela Carrasco Yepez', birthDate: '1993-02-28', equifaxBaseScore: 620, employment: { employer: 'Coca-Cola Ecuador', salary: 1020, monthsActive: 54 }, altScore: { score: 56, signals: ['regular_income', 'moderate_spending'] } },
  { name: 'Pablo Moncayo Rivas', birthDate: '1981-07-19', equifaxBaseScore: 780, employment: { employer: 'Petroamazonas', salary: 1950, monthsActive: 144 }, altScore: { score: 88, signals: ['high_digital_footprint', 'stable_spending', 'no_chargebacks'] } },
  { name: 'Gabriela Salazar Diaz', birthDate: '1989-04-06', equifaxBaseScore: 730, employment: { employer: 'Universidad San Francisco', salary: 1420, monthsActive: 102 }, altScore: { score: 79, signals: ['stable_spending', 'long_account_history'] } },
  { name: 'Manuel Zambrano Toro', birthDate: '1977-11-15', equifaxBaseScore: 690, employment: { employer: 'Municipio de Guayaquil', salary: 1180, monthsActive: 180 }, altScore: { score: 70, signals: ['utility_payer', 'long_account_history'] } },
  { name: 'Jessica Coronel Pacheco', birthDate: '1994-08-21', equifaxBaseScore: 540, employment: { employer: 'Sweet & Coffee', salary: 720, monthsActive: 36 }, altScore: { score: 38, signals: ['young_account', 'irregular_income'] } },
  { name: 'Sebastian Endara Lima', birthDate: '1983-03-30', equifaxBaseScore: 770, employment: { employer: 'Banco Pacífico', salary: 1740, monthsActive: 126 }, altScore: { score: 84, signals: ['stable_spending', 'no_chargebacks', 'high_digital_footprint'] } },
  { name: 'Carolina Velastegui Mejia', birthDate: '1991-12-04', equifaxBaseScore: 690, employment: { employer: 'Telefónica Ecuador', salary: 1230, monthsActive: 66 }, altScore: { score: 66, signals: ['regular_income', 'utility_payer'] } },
  { name: 'Ricardo Pineda Aguilar', birthDate: '1979-09-09', equifaxBaseScore: 750, employment: { employer: 'EPMAPS', salary: 1480, monthsActive: 156 }, altScore: { score: 80, signals: ['stable_spending', 'long_account_history'] } },
  { name: 'Lorena Saltos Borja', birthDate: '1986-06-27', equifaxBaseScore: 700, employment: { employer: 'IESS', salary: 1320, monthsActive: 114 }, altScore: { score: 73, signals: ['stable_spending', 'utility_payer'] } },
  { name: 'Hugo Yanez Salgado', birthDate: '1974-01-13', equifaxBaseScore: 790, employment: { employer: 'CNT EP', salary: 1680, monthsActive: 198 }, altScore: { score: 86, signals: ['long_account_history', 'no_chargebacks', 'early_payments'] } },
  { name: 'Estefania Gallardo Ruiz', birthDate: '1997-04-18', equifaxBaseScore: 480, employment: { employer: 'Tía S.A.', salary: 680, monthsActive: 18 }, altScore: { score: 32, signals: ['young_account', 'irregular_income'] } },
  { name: 'Esteban Padilla Llerena', birthDate: '1984-10-26', equifaxBaseScore: 700, employment: { employer: 'Corporación Favorita', salary: 1290, monthsActive: 102 }, altScore: { score: 71, signals: ['stable_spending', 'utility_payer'] } },
  { name: 'Nicole Cabrera Almeida', birthDate: '1998-03-07', equifaxBaseScore: 420, employment: { employer: 'Mall del Sol', salary: 590, monthsActive: 12 }, altScore: { score: 28, signals: ['young_account', 'high_volatility', 'irregular_income'] } },
  { name: 'Marco Sotomayor Ulloa', birthDate: '1976-08-31', equifaxBaseScore: 800, employment: { employer: 'Refinería Esmeraldas', salary: 1820, monthsActive: 168 }, altScore: { score: 89, signals: ['high_digital_footprint', 'no_chargebacks', 'long_account_history'] } },
  { name: 'Cristina Aguirre Vinueza', birthDate: '1992-05-14', equifaxBaseScore: 620, employment: { employer: 'KFC Ecuador', salary: 740, monthsActive: 48 }, altScore: { score: 52, signals: ['regular_income', 'moderate_spending'] } },
  { name: 'Felipe Davila Acosta', birthDate: '1980-11-22', equifaxBaseScore: 760, employment: { employer: 'Banco Internacional', salary: 1560, monthsActive: 132 }, altScore: { score: 83, signals: ['stable_spending', 'no_chargebacks', 'high_digital_footprint'] } },
  { name: 'Karla Heredia Flores', birthDate: '1988-02-09', equifaxBaseScore: 680, employment: { employer: 'Universidad Central', salary: 1140, monthsActive: 84 }, altScore: { score: 67, signals: ['stable_spending', 'utility_payer'] } },
  { name: 'Alejandro Cevallos Mata', birthDate: '1995-07-16', equifaxBaseScore: 590, employment: { employer: 'Diario El Comercio', salary: 920, monthsActive: 36 }, altScore: { score: 49, signals: ['young_account', 'moderate_spending'] } },
  { name: 'Monica Rosales Carvajal', birthDate: '1972-12-29', equifaxBaseScore: 770, employment: { employer: 'Casa Tosi', salary: 1380, monthsActive: 204 } },
  { name: 'Javier Almeida Ortega', birthDate: '1990-01-04', equifaxBaseScore: 640, employment: { employer: 'Pacificard', salary: 1240, monthsActive: 72 } },
  { name: 'Tatiana Espinosa Granda', birthDate: '1985-09-12', equifaxBaseScore: 740, employment: { employer: 'Produbanco', salary: 1490, monthsActive: 108 } },
  { name: 'Gustavo Naula Pillajo', birthDate: '1978-04-25', equifaxBaseScore: 780, employment: { employer: 'CELEC EP', salary: 1670, monthsActive: 156 } },
  { name: 'Renata Quishpe Maldonado', birthDate: '1996-10-08', equifaxBaseScore: 530, employment: { employer: 'Mi Comisariato', salary: 720, monthsActive: 30 } },
  // ---- vivos autónomos (5) — sin employment ----
  { name: 'Bryan Calderon Sevilla', birthDate: '1993-06-19', equifaxBaseScore: 660 },
  { name: 'Adriana Velez Morejon', birthDate: '1981-03-02', equifaxBaseScore: 580 },
  { name: 'Mauricio Recalde Tobar', birthDate: '1987-08-15', equifaxBaseScore: 770 },
  { name: 'Camila Bermeo Pesantez', birthDate: '1994-11-20', equifaxBaseScore: 380 },
  { name: 'Diego Solis Carrera', birthDate: '1982-05-07', equifaxBaseScore: 700 },
  // ---- fallecidos (5) — historical scores ----
  { name: 'Eduardo Vinueza Tapia', birthDate: '1948-03-15', deathDate: '2021-06-12', equifaxBaseScore: 720 },
  { name: 'Mercedes Cabrera Lopez', birthDate: '1952-08-22', deathDate: '2019-11-04', equifaxBaseScore: 800 },
  { name: 'Jose Andrade Pinto', birthDate: '1955-01-10', deathDate: '2023-02-28', equifaxBaseScore: 600 },
  { name: 'Rosa Saltos Ruiz', birthDate: '1950-12-03', deathDate: '2020-09-17', equifaxBaseScore: 480 },
  { name: 'Pedro Heredia Cruz', birthDate: '1945-07-19', deathDate: '2018-04-25', equifaxBaseScore: 470 },
];

export const personas: Persona[] = ENTRIES.map((entry, index) => ({
  cedula: makeCedula(index),
  ...entry,
}));

/**
 * Cedulas with valid checksum that intentionally have NO matching persona.
 * Used to demonstrate the DomainError('not_found') path: the cedula is
 * well-formed and the registro civil "responded" cleanly with "no record".
 */
export const cedulasNotFound: string[] = [
  makeCedula(45),
  makeCedula(46),
  makeCedula(47),
  makeCedula(48),
  makeCedula(49),
];
