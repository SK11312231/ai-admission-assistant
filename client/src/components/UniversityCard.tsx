interface University {
  id: number;
  name: string;
  location: string;
  ranking: number;
  acceptance_rate: number;
  programs: string[];
  description: string;
}

interface Props {
  university: University;
}

export default function UniversityCard({ university }: Props) {
  const { name, location, ranking, acceptance_rate, programs, description } = university;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 text-base leading-snug">{name}</h3>
        <span className="flex-shrink-0 bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-1 rounded-full">
          #{ranking}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span className="flex items-center gap-1">
          <span>📍</span> {location}
        </span>
        <span className="flex items-center gap-1">
          <span>📊</span> {acceptance_rate}% acceptance
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 line-clamp-3">{description}</p>

      {/* Programs */}
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {programs.slice(0, 4).map((prog) => (
          <span
            key={prog}
            className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full"
          >
            {prog}
          </span>
        ))}
        {programs.length > 4 && (
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
            +{programs.length - 4} more
          </span>
        )}
      </div>
    </div>
  );
}
