import { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem('institute'));

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('institute'));
  }, [location]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors ${
      isActive ? 'text-indigo-600' : 'text-gray-600 hover:text-indigo-600'
    }`;

  const handleLogout = () => {
    localStorage.removeItem('institute');
    setLoggedIn(false);
    navigate('/');
  };

  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 text-indigo-600 font-bold text-lg">
          <span className="text-2xl">📲</span>
          <span>LeadCapture</span>
        </Link>

        {/* Navigation links */}
        <div className="flex items-center gap-6">
          {loggedIn ? (
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-gray-600 hover:text-red-600 transition-colors"
            >
              Logout
            </button>
          ) : (
            <>
              <NavLink to="/" end className={linkClass}>
                Home
              </NavLink>
              <NavLink to="/login" className={linkClass}>
                Login
              </NavLink>
              <NavLink
                to="/register"
                className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Register
              </NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
