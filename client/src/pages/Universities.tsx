import { useEffect, useState } from 'react';
import UniversityCard from '../components/UniversityCard';
import { apiUrl } from '../lib/api';

interface University {
  id: number;
  name: string;
  location: string;
  ranking: number;
  acceptance_rate: number;
  programs: string[];
  description: string;
}

export default function Universities() {
  const [universities, setUniversities] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUniversities = async () => {
      try {
        const res = await fetch(apiUrl('/api/universities'));
        if (!res.ok) throw new Error('Failed to load universities.');
        const data = (await res.json()) as University[];
        setUniversities(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    void fetchUniversities();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Top Universities</h1>
        <p className="text-gray-500 max-w-xl mx-auto">
          Explore our curated list of top universities. Click "Chat with AI" to get personalized
          recommendations based on your profile.
        </p>
      </div>

      {loading && (
        <div className="text-center py-20 text-gray-500">
          <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
          <p>Loading universities…</p>
        </div>
      )}

      {error && (
        <div className="text-center py-20 text-red-600">
          <p>⚠️ {error}</p>
          <p className="text-sm text-gray-500 mt-2">Make sure the server is running and the database is seeded.</p>
        </div>
      )}

      {!loading && !error && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {universities.map((uni) => (
            <UniversityCard key={uni.id} university={uni} />
          ))}
        </div>
      )}
    </div>
  );
}
