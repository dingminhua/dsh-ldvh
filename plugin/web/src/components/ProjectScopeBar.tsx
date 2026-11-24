import { Check } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { projectColorVar, resolvedProjectColorKey } from '@/shared/projectColors';
import { useProjectScope } from '@/utils/projectContext';

type BranchOption = { path: string; branch?: string; isMain?: boolean };

export default function ProjectScopeBar() {
  const { t } = useI18n();
  const { projects, selectedProjectId, selectedWorktreePath, selectProject, loading, error } = useProjectScope();

  if (loading || error || projects.length === 0) return null;

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedColorKey = selectedProject ? resolvedProjectColorKey(selectedProject.color, selectedProject.id) : null;
  const selectedColor = selectedColorKey ? projectColorVar(selectedColorKey) : '';
  const branches: BranchOption[] = selectedProject
    ? (selectedProject.worktrees.length > 0 ? selectedProject.worktrees : [{ path: selectedProject.path, isMain: true }])
    : [];

  return (
    <div className="ldvh-scope-bar">
      <div className="ldvh-scope-tab-list" role="tablist" aria-label={t('projectSwitcher.label')}>
        {projects.map((project) => {
          const color = projectColorVar(resolvedProjectColorKey(project.color, project.id));
          const selected = project.id === selectedProjectId;
          const branchCount = project.worktrees.length > 0 ? project.worktrees.length : 1;
          return (
            <button
              key={project.id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={project.path}
              onClick={() => selectProject(project.id)}
              className={`ldvh-scope-tab ${selected ? 'ldvh-scope-tab-selected' : ''}`}
              style={selected ? { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}
            >
              <span aria-hidden="true" className="ldvh-scope-dot" style={{ backgroundColor: color }} />
              <span className="ldvh-scope-name">{project.name || project.id}</span>
              <span
                className="ldvh-scope-count"
                style={{ borderColor: color, color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
              >
                {branchCount}
              </span>
              {selected && <Check aria-hidden="true" size={12} strokeWidth={3} className="shrink-0" style={{ color }} />}
            </button>
          );
        })}
      </div>

      {selectedProject && (
        <div className="ldvh-scope-tab-list" role="tablist" aria-label={t('projectSwitcher.label')}>
          {branches.map((branch) => {
            const selected = branch.path === selectedWorktreePath;
            const label = branch.branch || t('projectSwitcher.detached');
            return (
              <button
                key={branch.path}
                type="button"
                role="tab"
                aria-selected={selected}
                title={branch.path}
                onClick={() => selectProject(selectedProject.id, branch.path)}
                className={`ldvh-scope-tab ${selected ? 'ldvh-scope-tab-selected' : ''}`}
                style={selected ? { borderColor: selectedColor, backgroundColor: `color-mix(in srgb, ${selectedColor} 12%, transparent)` } : undefined}
              >
                <span
                  aria-hidden="true"
                  className="ldvh-scope-dot"
                  style={selected ? { backgroundColor: selectedColor } : { borderColor: 'var(--ldvh-border)' }}
                />
                <span className={`ldvh-scope-name ${selected ? 'ldvh-scope-name-selected' : ''}`} style={selected ? { color: selectedColor } : undefined}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
