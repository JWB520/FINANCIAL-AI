/**
 * features/dimension-picker/DimensionPicker.tsx —— 选维度 + 依赖资料提示
 *
 * 【这个小模块是整个系统"可信"的关键入口】
 *   用户勾了"观点交叉验证"，但资料库里没有外部研报 —— 这时系统必须告诉他：
 *   "这个维度跑不了，结果会是**未覆盖**，而不是通过"。
 *   如果不说，用户会以为这条查过了没问题 —— 那是最危险的失败模式。
 *
 * 【依赖提示怎么算出来的】
 *   每个维度在后端注册表里声明了 required_inputs（需要哪些资料），
 *   前端把"已勾选维度的 required_inputs"求并集，再减去"已配置的资料"，
 *   差集就是缺的东西。所以后端加一个维度，前端不用改代码就能正确提示。
 *
 * 【本文件导出】
 *   DimensionPicker   维度勾选（按组展示）
 *   DependencyHint    依赖资料提示条（也可被核查设置页单独复用）
 */
import { Alert, Checkbox, Space, Tag, Tooltip } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, UploadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { CheckMode, Dimension } from '@/api'
import { DIMENSION_GROUP_LABEL, MODE_LABEL, requiredInputHint, requiredInputLabel } from '@/api'

/** 计算"已勾选维度需要哪些资料"（并集） */
export function collectRequiredInputs(dimensions: Dimension[], selected: string[]): string[] {
  const result = new Set<string>()
  dimensions
    .filter((d) => selected.includes(d.code))
    .forEach((d) => d.required_inputs.forEach((input) => result.add(input)))
  return Array.from(result)
}

/**
 * 依赖资料提示。
 * @param required 已勾选维度需要的资料
 * @param available 目前已经配置好的资料（后端返回，例如已上传并启用）
 * @param onUpload 点"去配置"时的回调
 */
export function DependencyHint({
  required,
  available,
  onUpload,
}: {
  required: string[]
  available: string[]
  onUpload?: (inputCode: string) => void
}) {
  if (!required.length) {
    return (
      <Alert
        type="success"
        showIcon
        message="所选维度不需要额外资料，可以直接开始核查"
        style={{ fontSize: 13 }}
      />
    )
  }

  const missing = required.filter((input) => !available.includes(input))

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13 }}>
        已选维度需要以下资料：
        {required.map((input) => {
          const ok = available.includes(input)
          return (
            <Tag
              key={input}
              color={ok ? 'success' : 'error'}
              icon={ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              style={{ marginLeft: 8 }}
            >
              {requiredInputLabel(input)}（{ok ? '已配置' : '缺失'}）
            </Tag>
          )
        })}
      </div>

      {missing.length ? (
        <Alert
          type="warning"
          showIcon
          message="缺资料不会导致核查失败，但相关维度会被标记为「未覆盖」"
          description={
            <div>
              {missing.map((input) => (
                <div key={input} style={{ marginBottom: 4 }}>
                  · <b>{requiredInputLabel(input)}</b>：{requiredInputHint(input)}
                </div>
              ))}
              <div className="meta-text" style={{ marginTop: 4 }}>
                注意：未覆盖表示"这次没查"，不等于"没问题"，它会单独统计，不会被算进通过率。
              </div>
            </div>
          }
          action={
            onUpload ? (
              <Button size="small" icon={<UploadOutlined />} onClick={() => onUpload(missing[0])}>
                去配置资料
              </Button>
            ) : null
          }
        />
      ) : (
        <Alert type="success" showIcon message="所需资料已齐备，本次核查可以全部覆盖" style={{ fontSize: 13 }} />
      )}
    </div>
  )
}

/**
 * 维度勾选组件。
 * @param dimensions 后端返回的维度注册表
 * @param mode 当前选择的模式（quick / deep），用于置灰"仅深度评估可用"的维度
 * @param selected 已勾选的维度代号
 * @param onToggle 勾选变化
 */
export function DimensionPicker({
  dimensions,
  mode,
  selected,
  onToggle,
}: {
  dimensions: Dimension[]
  mode: CheckMode
  selected: string[]
  onToggle: (code: string, checked: boolean) => void
}) {
  // 按 group 分组：核查维度（找问题）与质量评估维度（评整体）
  const groups: Array<'check' | 'quality'> = ['check', 'quality']

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {groups.map((group) => {
        const items = dimensions.filter((d) => d.group === group)
        if (!items.length) return null
        return (
          <div key={group}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{DIMENSION_GROUP_LABEL[group]}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {items.map((dimension) => {
                // 当前模式不支持这个维度：置灰并说明原因（而不是藏起来）
                const disabled = !dimension.enabled_in_modes.includes(mode)
                const checked = selected.includes(dimension.code)
                return (
                  <div
                    key={dimension.code}
                    style={{
                      border: '1px solid ' + (checked ? '#91caff' : '#f0f0f0'),
                      background: checked ? '#f0f7ff' : '#fff',
                      borderRadius: 6,
                      padding: '10px 12px',
                      opacity: disabled ? 0.55 : 1,
                    }}
                  >
                    <Checkbox
                      disabled={disabled}
                      checked={checked}
                      onChange={(e) => onToggle(dimension.code, e.target.checked)}
                    >
                      <span style={{ fontWeight: 500 }}>{dimension.name}</span>
                      {dimension.default_risk_level ? (
                        <Tooltip title="该维度命中的问题通常会定到这一等级（最终等级由规则表决定）">
                          <Tag style={{ marginLeft: 8 }} color="default">
                            常见等级：{dimension.default_risk_level === 'high' ? '高' : dimension.default_risk_level === 'medium' ? '中' : '低'}
                          </Tag>
                        </Tooltip>
                      ) : null}
                    </Checkbox>
                    <div className="meta-text" style={{ marginTop: 4, marginLeft: 24 }}>
                      {dimension.description}
                      {disabled ? (
                        <span style={{ color: '#d46b08' }}>（仅 {dimension.enabled_in_modes.map((m) => MODE_LABEL[m]).join('、')} 中可用）</span>
                      ) : null}
                      {dimension.required_inputs.length ? (
                        <span>
                          {' '}
                          需要：{dimension.required_inputs.map((i) => requiredInputLabel(i)).join('、')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </Space>
  )
}