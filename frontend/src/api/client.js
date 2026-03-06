import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

export const dashboardApi = {
  getStats: (instituteId) =>
    api.get(`/dashboard/stats?institute_id=${instituteId}`),
}

export const leadsApi = {
  getLeads: (instituteId, status = null) => {
    const params = new URLSearchParams({ institute_id: instituteId })
    if (status) params.append('status', status)
    return api.get(`/leads/?${params}`)
  },
  createLead: (data) => api.post('/leads/', data),
  updateLead: (id, data) => api.patch(`/leads/${id}`, data),
  deleteLead: (id) => api.delete(`/leads/${id}`),
}

export const institutesApi = {
  getInstitute: (id) => api.get(`/institutes/${id}`),
  updateInstitute: (id, data) => api.patch(`/institutes/${id}`, data),
}

export default api
