"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Input, Space, Table } from "antd";
import { useMemo } from "react";
import { createDownloadRecordColumns } from "@/components/console/download-columns";
import { useDownloadsData } from "@/components/console/hooks/use-downloads-data";

export function DownloadsPage() {
  const columns = useMemo(() => createDownloadRecordColumns(), []);
  const {
    downloadRecords,
    downloadQuery,
    setDownloadQuery,
    loading,
    loadDownloads,
    searchDownloads,
  } = useDownloadsData();

  return (
    <>
      <Card
        title="下载记录"
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="搜索文件名、标题、说明"
              value={downloadQuery}
              onChange={(event) => setDownloadQuery(event.target.value)}
              onSearch={() => void searchDownloads()}
              style={{ width: 260 }}
            />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadDownloads()} />
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={downloadRecords}
          loading={loading}
          size="middle"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1180 }}
        />
      </Card>
    </>
  );
}
