/**
 * features/project/useLocalProject.ts —— 打开一个本地项目（项目配置 + 它对应的报告）
 *
 * 【打开项目要做的两件事，别人不用再操心】
 *   1. 读本地项目配置文件（project.json）：知道研报路径、知识库路径在哪；
 *   2. 确保"报告"这个后端实体已就绪：结论（勘误/评估/复核）都挂在报告上，
 *      没有报告三个入口就没有东西可看 —— 所以这里调 reportApi.ensureProject（幂等）。
 *
 * 【本文件定义】
 *   useLocalProject(projectId)  返回 { config, report, isLoading, error, refetch }
 *     config  项目配置（含 report_path / knowledge_dir / dir）
 *     report  该项目对应的报告（三个入口的跳转要用它的 id）
 */
import { useQuery } from '@tanstack/react-query'
import { reportApi, type Report } from '@/api'
import { desktop, type LocalProjectConfig } from '@/api/local/desktop'

export function useLocalProject(projectId: string) {
  /** 第一步：读项目配置 */
  const configQuery = useQuery<LocalProjectConfig | null>({
    queryKey: ['local-project', projectId],
    queryFn: () => desktop.openProject(projectId),
    enabled: Boolean(projectId) && desktop.isDesktop(),
    retry: false,
  })

  /** 第二步：保证报告已就绪（幂等；演示数据下会直接用现成的一套结论） */
  const reportQuery = useQuery<Report>({
    queryKey: ['local-project', projectId, 'report'],
    queryFn: () =>
      reportApi.ensureProject({
        project_id: projectId,
        report_path: configQuery.data!.report_path,
        report_name: configQuery.data!.name,
      }),
    enabled: Boolean(configQuery.data?.report_path),
    retry: false,
  })

  return {
    config: configQuery.data ?? null,
    report: reportQuery.data ?? null,
    isLoading: configQuery.isLoading || (Boolean(configQuery.data) && reportQuery.isLoading),
    error: configQuery.error ?? reportQuery.error,
    refetch: () => {
      configQuery.refetch()
      reportQuery.refetch()
    },
  }
}