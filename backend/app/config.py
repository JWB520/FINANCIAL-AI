"""全局配置：读 .env（pydantic-settings），只在这里读环境变量。

约定：业务代码不直接读 os.environ，一律 from app.config import get_settings。
好处：换部署环境只改 .env；测试里可以覆盖。

对照文档：03_后端架构.md（技术栈）/ 06_工程规范与开发计划.md §4.2（默认端口）
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # env_prefix 必须是 RQC_：`.env.example` 里所有键名都是 RQC_*（RQC_LLM_API_KEY、RQC_DATABASE_URL…）。
    # 【这是一个真 bug 的修复】骨架期这里漏了 env_prefix，于是 pydantic 去找的是无前缀的
    # LLM_API_KEY / DATABASE_URL —— 谁照着 .env.example 配 Key 都不会生效，而且**不报错**，
    # 只表现为"模型未接入"，极难排查。
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="RQC_",
        extra="ignore",
    )

    # ---------- 应用 ----------
    app_name: str = "RQC 后端 · 研报核查与质量评估平台"
    env: str = "dev"                      # dev / test / prod
    debug: bool = True
    api_prefix: str = "/api/v1"           # ★ 前端所有请求都拼在这个前缀之后（不要改）

    # 服务地址与端口不在这里写死：由 .env 提供（见 .env.example 的 RQC_HTTP_* 两项），
    # 因为比赛演示与本机联调会换地址，写死在代码里会让"改一处"变成"改代码 + 重启"。

    # 允许的前端来源（前端用 fetch 手写 SSE，所以这条也走 CORS）
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "app://."]

    # 演示/联调期：没有 Authorization 时也放行为演示用户（上线前必须关掉）
    allow_anonymous_demo: bool = True

    # ---------- 存储 ----------
    database_url: str = "postgresql+psycopg://rqc:rqc@localhost:5432/rqc"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: str = "./var/storage"    # 上传的原始文件与导出物

    # ---------- 核查流水线 ----------
    check_concurrency: int = 4            # check 阶段并发上限（03 §3.4）
    stage_retry_limit: int = 2
    task_timeout_seconds: int = 1800

    # ---------- LLM 网关 ----------
    llm_provider: str = "deepseek"        # deepseek / openai / anthropic / ollama
    llm_model: str = "deepseek-chat"
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_temperature: float = 0.2
    llm_max_tokens: int = 4096
    llm_timeout_seconds: int = 60

    # ---------- 检索 ----------
    embedding_model: str = "bge-m3"
    kb_top_k: int = 8
    kb_similarity_threshold: float = 0.2


@lru_cache
def get_settings() -> Settings:
    """带缓存（读一次就够）；测试里用 get_settings.cache_clear() 重置。"""
    return Settings()
