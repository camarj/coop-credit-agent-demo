import { buildCedula } from './cedula';

export interface Persona {
  cedula: string;
  name: string;
  birthDate: string; // ISO YYYY-MM-DD
  deathDate?: string; // ISO YYYY-MM-DD if fallecida
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
const ENTRIES: Array<{
  name: string;
  birthDate: string;
  deathDate?: string;
}> = [
  // ---- vivos (40) ----
  { name: 'Maria Lopez Vargas', birthDate: '1985-04-12' },
  { name: 'Juan Perez Castillo', birthDate: '1978-07-23' },
  { name: 'Ana Rodriguez Mora', birthDate: '1992-11-05' },
  { name: 'Carlos Andrade Suarez', birthDate: '1980-02-18' },
  { name: 'Sofia Cevallos Ortiz', birthDate: '1995-09-30' },
  { name: 'Luis Gomez Paredes', birthDate: '1973-06-14' },
  { name: 'Patricia Vega Romero', birthDate: '1988-12-22' },
  { name: 'Diego Bustamante Cruz', birthDate: '1990-03-08' },
  { name: 'Veronica Naranjo Reyes', birthDate: '1982-08-17' },
  { name: 'Andres Tapia Cordero', birthDate: '1996-01-25' },
  { name: 'Fernanda Espinoza Lara', birthDate: '1987-05-11' },
  { name: 'Roberto Alvarez Pinto', birthDate: '1975-10-03' },
  { name: 'Daniela Carrasco Yepez', birthDate: '1993-02-28' },
  { name: 'Pablo Moncayo Rivas', birthDate: '1981-07-19' },
  { name: 'Gabriela Salazar Diaz', birthDate: '1989-04-06' },
  { name: 'Manuel Zambrano Toro', birthDate: '1977-11-15' },
  { name: 'Jessica Coronel Pacheco', birthDate: '1994-08-21' },
  { name: 'Sebastian Endara Lima', birthDate: '1983-03-30' },
  { name: 'Carolina Velastegui Mejia', birthDate: '1991-12-04' },
  { name: 'Ricardo Pineda Aguilar', birthDate: '1979-09-09' },
  { name: 'Lorena Saltos Borja', birthDate: '1986-06-27' },
  { name: 'Hugo Yanez Salgado', birthDate: '1974-01-13' },
  { name: 'Estefania Gallardo Ruiz', birthDate: '1997-04-18' },
  { name: 'Esteban Padilla Llerena', birthDate: '1984-10-26' },
  { name: 'Nicole Cabrera Almeida', birthDate: '1998-03-07' },
  { name: 'Marco Sotomayor Ulloa', birthDate: '1976-08-31' },
  { name: 'Cristina Aguirre Vinueza', birthDate: '1992-05-14' },
  { name: 'Felipe Davila Acosta', birthDate: '1980-11-22' },
  { name: 'Karla Heredia Flores', birthDate: '1988-02-09' },
  { name: 'Alejandro Cevallos Mata', birthDate: '1995-07-16' },
  { name: 'Monica Rosales Carvajal', birthDate: '1972-12-29' },
  { name: 'Javier Almeida Ortega', birthDate: '1990-01-04' },
  { name: 'Tatiana Espinosa Granda', birthDate: '1985-09-12' },
  { name: 'Gustavo Naula Pillajo', birthDate: '1978-04-25' },
  { name: 'Renata Quishpe Maldonado', birthDate: '1996-10-08' },
  { name: 'Bryan Calderon Sevilla', birthDate: '1993-06-19' },
  { name: 'Adriana Velez Morejon', birthDate: '1981-03-02' },
  { name: 'Mauricio Recalde Tobar', birthDate: '1987-08-15' },
  { name: 'Camila Bermeo Pesantez', birthDate: '1994-11-20' },
  { name: 'Diego Solis Carrera', birthDate: '1982-05-07' },
  // ---- fallecidos (5) ----
  {
    name: 'Eduardo Vinueza Tapia',
    birthDate: '1948-03-15',
    deathDate: '2021-06-12',
  },
  {
    name: 'Mercedes Cabrera Lopez',
    birthDate: '1952-08-22',
    deathDate: '2019-11-04',
  },
  {
    name: 'Jose Andrade Pinto',
    birthDate: '1955-01-10',
    deathDate: '2023-02-28',
  },
  {
    name: 'Rosa Saltos Ruiz',
    birthDate: '1950-12-03',
    deathDate: '2020-09-17',
  },
  {
    name: 'Pedro Heredia Cruz',
    birthDate: '1945-07-19',
    deathDate: '2018-04-25',
  },
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
