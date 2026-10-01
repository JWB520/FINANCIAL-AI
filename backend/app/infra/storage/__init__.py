"""对象存储适配：本地目录（默认）或 MinIO。

只暴露两个方法，业务层不关心文件到底放哪：
    put(key, data) -> uri
    open(uri) -> bytes
"""
from __future__ import annotations


class ObjectStorage:
    def put(self, key: str, data: bytes) -> str:
        raise NotImplementedError("ObjectStorage.put")

    def open(self, uri: str) -> bytes:
        raise NotImplementedError("ObjectStorage.open")
