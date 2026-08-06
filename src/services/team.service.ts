export interface TeamInfo {
  id: number;
  name: string;
}

export const TEAMS: TeamInfo[] = [
  { id: 1, name: 'Đội 1: Kỹ thuật vận hành' },
  { id: 2, name: 'Đội 2: Phát triển phần mềm' },
  { id: 3, name: 'Đội 3: Chăm sóc khách hàng' },
  { id: 4, name: 'Đội 4: Kinh doanh' },
  { id: 5, name: 'Đội 5: Kế toán + Sản phẩm' },
  { id: 6, name: 'Đội 6: HCNS + Đối soát + Lái xe' },
  { id: 7, name: 'Đội 7: VP HCM + Phát triển kd' },
  { id: 8, name: 'Đội 8: HĐQT + BGĐ + Trợ lý' }
];

export function getTeamName(teamId: number): string {
  const team = TEAMS.find(t => t.id === teamId);
  return team ? team.name : `Đội ${teamId}`;
}
