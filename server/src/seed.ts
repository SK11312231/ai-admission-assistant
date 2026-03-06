import db from './db';

interface UniversityRow {
  id: number;
  name: string;
}

const universities = [
  {
    name: 'Massachusetts Institute of Technology',
    location: 'Cambridge, MA',
    ranking: 1,
    acceptance_rate: 3.96,
    programs: JSON.stringify([
      'Computer Science',
      'Electrical Engineering',
      'Mechanical Engineering',
      'Physics',
      'Mathematics',
      'Biology',
      'Economics',
    ]),
    description:
      'MIT is a world-renowned research university focused on science and technology. It consistently ranks among the top universities globally and is known for its rigorous academics, cutting-edge research, and entrepreneurial culture.',
  },
  {
    name: 'Stanford University',
    location: 'Stanford, CA',
    ranking: 2,
    acceptance_rate: 3.68,
    programs: JSON.stringify([
      'Computer Science',
      'Business',
      'Engineering',
      'Medicine',
      'Law',
      'Human Biology',
      'Psychology',
    ]),
    description:
      'Stanford is a leading research university situated in the heart of Silicon Valley. It is renowned for its entrepreneurship culture, strong ties to the tech industry, and world-class faculty.',
  },
  {
    name: 'Harvard University',
    location: 'Cambridge, MA',
    ranking: 3,
    acceptance_rate: 3.41,
    programs: JSON.stringify([
      'Law',
      'Medicine',
      'Business',
      'Economics',
      'Political Science',
      'History',
      'Computer Science',
    ]),
    description:
      'Harvard is the oldest university in the United States and one of the most prestigious in the world. It offers exceptional programs across all disciplines with unmatched alumni networks and research resources.',
  },
  {
    name: 'California Institute of Technology',
    location: 'Pasadena, CA',
    ranking: 4,
    acceptance_rate: 3.92,
    programs: JSON.stringify([
      'Physics',
      'Chemistry',
      'Astronomy',
      'Computer Science',
      'Aerospace Engineering',
      'Biology',
      'Mathematics',
    ]),
    description:
      'Caltech is a small but elite science and engineering institute. With one of the lowest student-to-faculty ratios in the country, it offers an intensely collaborative research environment.',
  },
  {
    name: 'Princeton University',
    location: 'Princeton, NJ',
    ranking: 5,
    acceptance_rate: 4.7,
    programs: JSON.stringify([
      'Economics',
      'Public Policy',
      'Computer Science',
      'Mathematics',
      'History',
      'International Affairs',
      'Engineering',
    ]),
    description:
      'Princeton is a highly selective Ivy League university with a strong emphasis on undergraduate education. It is particularly noted for its programs in public policy, economics, and the humanities.',
  },
  {
    name: 'University of Chicago',
    location: 'Chicago, IL',
    ranking: 6,
    acceptance_rate: 5.4,
    programs: JSON.stringify([
      'Economics',
      'Sociology',
      'Philosophy',
      'Political Science',
      'Statistics',
      'Chemistry',
      'Business',
    ]),
    description:
      'UChicago is celebrated for its rigorous core curriculum and intellectual culture. It has produced more Nobel laureates per student than nearly any other university and is a leader in economics and social sciences.',
  },
  {
    name: 'Columbia University',
    location: 'New York, NY',
    ranking: 7,
    acceptance_rate: 3.9,
    programs: JSON.stringify([
      'Journalism',
      'International Affairs',
      'Business',
      'Engineering',
      'Law',
      'Medicine',
      'Film',
    ]),
    description:
      'Columbia is an Ivy League research university in the heart of New York City. Its location provides unparalleled access to internships, cultural experiences, and professional networks across every industry.',
  },
  {
    name: 'University of Pennsylvania',
    location: 'Philadelphia, PA',
    ranking: 8,
    acceptance_rate: 5.9,
    programs: JSON.stringify([
      'Business (Wharton)',
      'Medicine',
      'Law',
      'Nursing',
      'Engineering',
      'Social Work',
      'Computer Science',
    ]),
    description:
      'Penn is an Ivy League university best known for the Wharton School of Business, one of the top business schools in the world. It offers a highly interdisciplinary environment with strong professional programs.',
  },
  {
    name: 'Duke University',
    location: 'Durham, NC',
    ranking: 9,
    acceptance_rate: 6.3,
    programs: JSON.stringify([
      'Medicine',
      'Law',
      'Public Policy',
      'Environmental Science',
      'Engineering',
      'Business',
      'Neuroscience',
    ]),
    description:
      'Duke is a top research university renowned for its medical school, law school, and commitment to public service. It combines academic excellence with a vibrant campus life and competitive athletics.',
  },
  {
    name: 'Johns Hopkins University',
    location: 'Baltimore, MD',
    ranking: 10,
    acceptance_rate: 7.0,
    programs: JSON.stringify([
      'Medicine',
      'Public Health',
      'Nursing',
      'Engineering',
      'International Studies',
      'Computer Science',
      'Biomedical Engineering',
    ]),
    description:
      'Johns Hopkins is a world leader in medical research and public health education. It is the first research university in the United States and continues to set the standard for translational research and graduate education.',
  },
];

/**
 * Seeds the universities table with sample data.
 * Safe to call multiple times — does nothing if data already exists.
 * @param verbose - set true to log a message when already seeded (CLI usage)
 */
export function seed(verbose = false): void {
  const existing = db.prepare('SELECT id FROM universities LIMIT 1').get() as UniversityRow | undefined;

  if (existing) {
    if (verbose) console.log('ℹ️  Database already seeded. Skipping.');
    return;
  }

  const insert = db.prepare(`
    INSERT INTO universities (name, location, ranking, acceptance_rate, programs, description)
    VALUES (@name, @location, @ranking, @acceptance_rate, @programs, @description)
  `);

  const insertMany = db.transaction((rows: typeof universities) => {
    for (const row of rows) {
      insert.run(row);
    }
  });

  insertMany(universities);
  console.log(`✅ Seeded ${universities.length} universities into the database.`);
}

// When run directly as a CLI script (npm run seed), always show output.
// Use includes() so it matches both src/seed.ts and dist/seed.js paths.
if (process.argv[1]?.includes('/seed.ts') || process.argv[1]?.includes('/seed.js')) {
  seed(true);
}
