import { buildCedula } from './cedula';

export interface Employment {
  employer: string;
  salary: number; // USD per month declared at IESS
  monthsActive: number; // months of continuous active affiliation
}

export interface Persona {
  cedula: string;
  name: string;
  birthDate: string; // ISO YYYY-MM-DD
  deathDate?: string; // ISO YYYY-MM-DD if fallecida
  employment?: Employment; // absent ⇒ autónomo / no afiliado al IESS
  equifaxBaseScore: number; // [350, 820] — score before any hard inquiry. Required.
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
};

const ENTRIES: Entry[] = [
  // ---- vivos afiliados (35) ----
  { name: 'Maria Lopez Vargas', birthDate: '1985-04-12', equifaxBaseScore: 720, employment: { employer: 'Banco Pichincha', salary: 1450, monthsActive: 84 } },
  { name: 'Juan Perez Castillo', birthDate: '1978-07-23', equifaxBaseScore: 700, employment: { employer: 'Empresa Eléctrica Quito', salary: 1280, monthsActive: 156 } },
  { name: 'Ana Rodriguez Mora', birthDate: '1992-11-05', equifaxBaseScore: 660, employment: { employer: 'Corporación La Favorita', salary: 920, monthsActive: 42 } },
  { name: 'Carlos Andrade Suarez', birthDate: '1980-02-18', equifaxBaseScore: 740, employment: { employer: 'Cervecería Nacional', salary: 1620, monthsActive: 120 } },
  { name: 'Sofia Cevallos Ortiz', birthDate: '1995-09-30', equifaxBaseScore: 660, employment: { employer: 'Pronaca', salary: 780, monthsActive: 28 } },
  { name: 'Luis Gomez Paredes', birthDate: '1973-06-14', equifaxBaseScore: 800, employment: { employer: 'Banco Guayaquil', salary: 2150, monthsActive: 192 } },
  { name: 'Patricia Vega Romero', birthDate: '1988-12-22', equifaxBaseScore: 710, employment: { employer: 'Holcim', salary: 1340, monthsActive: 96 } },
  { name: 'Diego Bustamante Cruz', birthDate: '1990-03-08', equifaxBaseScore: 680, employment: { employer: 'Diners Club', salary: 1180, monthsActive: 72 } },
  { name: 'Veronica Naranjo Reyes', birthDate: '1982-08-17', equifaxBaseScore: 750, employment: { employer: 'Conecel - Claro', salary: 1560, monthsActive: 132 } },
  { name: 'Andres Tapia Cordero', birthDate: '1996-01-25', equifaxBaseScore: 580, employment: { employer: 'Movistar', salary: 850, monthsActive: 24 } },
  { name: 'Fernanda Espinoza Lara', birthDate: '1987-05-11', equifaxBaseScore: 720, employment: { employer: 'Banco Bolivariano', salary: 1390, monthsActive: 108 } },
  { name: 'Roberto Alvarez Pinto', birthDate: '1975-10-03', equifaxBaseScore: 810, employment: { employer: 'OCP Ecuador', salary: 2480, monthsActive: 168 } },
  { name: 'Daniela Carrasco Yepez', birthDate: '1993-02-28', equifaxBaseScore: 620, employment: { employer: 'Coca-Cola Ecuador', salary: 1020, monthsActive: 54 } },
  { name: 'Pablo Moncayo Rivas', birthDate: '1981-07-19', equifaxBaseScore: 780, employment: { employer: 'Petroamazonas', salary: 1950, monthsActive: 144 } },
  { name: 'Gabriela Salazar Diaz', birthDate: '1989-04-06', equifaxBaseScore: 730, employment: { employer: 'Universidad San Francisco', salary: 1420, monthsActive: 102 } },
  { name: 'Manuel Zambrano Toro', birthDate: '1977-11-15', equifaxBaseScore: 690, employment: { employer: 'Municipio de Guayaquil', salary: 1180, monthsActive: 180 } },
  { name: 'Jessica Coronel Pacheco', birthDate: '1994-08-21', equifaxBaseScore: 540, employment: { employer: 'Sweet & Coffee', salary: 720, monthsActive: 36 } },
  { name: 'Sebastian Endara Lima', birthDate: '1983-03-30', equifaxBaseScore: 770, employment: { employer: 'Banco Pacífico', salary: 1740, monthsActive: 126 } },
  { name: 'Carolina Velastegui Mejia', birthDate: '1991-12-04', equifaxBaseScore: 690, employment: { employer: 'Telefónica Ecuador', salary: 1230, monthsActive: 66 } },
  { name: 'Ricardo Pineda Aguilar', birthDate: '1979-09-09', equifaxBaseScore: 750, employment: { employer: 'EPMAPS', salary: 1480, monthsActive: 156 } },
  { name: 'Lorena Saltos Borja', birthDate: '1986-06-27', equifaxBaseScore: 700, employment: { employer: 'IESS', salary: 1320, monthsActive: 114 } },
  { name: 'Hugo Yanez Salgado', birthDate: '1974-01-13', equifaxBaseScore: 790, employment: { employer: 'CNT EP', salary: 1680, monthsActive: 198 } },
  { name: 'Estefania Gallardo Ruiz', birthDate: '1997-04-18', equifaxBaseScore: 480, employment: { employer: 'Tía S.A.', salary: 680, monthsActive: 18 } },
  { name: 'Esteban Padilla Llerena', birthDate: '1984-10-26', equifaxBaseScore: 700, employment: { employer: 'Corporación Favorita', salary: 1290, monthsActive: 102 } },
  { name: 'Nicole Cabrera Almeida', birthDate: '1998-03-07', equifaxBaseScore: 420, employment: { employer: 'Mall del Sol', salary: 590, monthsActive: 12 } },
  { name: 'Marco Sotomayor Ulloa', birthDate: '1976-08-31', equifaxBaseScore: 800, employment: { employer: 'Refinería Esmeraldas', salary: 1820, monthsActive: 168 } },
  { name: 'Cristina Aguirre Vinueza', birthDate: '1992-05-14', equifaxBaseScore: 620, employment: { employer: 'KFC Ecuador', salary: 740, monthsActive: 48 } },
  { name: 'Felipe Davila Acosta', birthDate: '1980-11-22', equifaxBaseScore: 760, employment: { employer: 'Banco Internacional', salary: 1560, monthsActive: 132 } },
  { name: 'Karla Heredia Flores', birthDate: '1988-02-09', equifaxBaseScore: 680, employment: { employer: 'Universidad Central', salary: 1140, monthsActive: 84 } },
  { name: 'Alejandro Cevallos Mata', birthDate: '1995-07-16', equifaxBaseScore: 590, employment: { employer: 'Diario El Comercio', salary: 920, monthsActive: 36 } },
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
