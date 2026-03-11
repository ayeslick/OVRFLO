import { MOCK_DASHBOARD_DATA } from "@/lib/mock-dashboard";

interface DashboardDataResult {
  actionsDisabled: boolean;
  isPreview: boolean;
  launchReadError?: Error;
}

export function useDashboardData(): typeof MOCK_DASHBOARD_DATA & DashboardDataResult {
  return {
    ...MOCK_DASHBOARD_DATA,
    actionsDisabled: false,
    isPreview: true,
    launchReadError: undefined,
  };
}