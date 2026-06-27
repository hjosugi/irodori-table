import { describe, expect, it } from "vitest";
import {
  exportConnectionProfiles,
  importConnectionProfiles,
} from "@/features/connections/connection-transfer";
import type { ConnectionDraft } from "@/features/connections/connection-profiles";

function profile(patch: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "warehouse",
    name: "Warehouse",
    color: "#2563eb",
    engine: "postgres",
    mode: "fields",
    url: "",
    host: "db.example.test",
    port: "5432",
    user: "analyst",
    password: "secret",
    database: "analytics",
    ...patch,
  };
}

describe("connection transfer", () => {
  it("imports DBeaver CSV and strips URL passwords", () => {
    const imported = importConnectionProfiles(
      [
        "name,type,host,port,database,url,user,password",
        "Warehouse,postgresql,db.example.test,5432,analytics,postgres://analyst:secret@db.example.test:5432/analytics,analyst,secret",
      ].join("\n"),
      "dbeaver-connections.csv",
    );

    expect(imported.source).toBe("DBeaver CSV");
    expect(imported.profiles[0]).toMatchObject({
      name: "Warehouse",
      engine: "postgres",
      host: "db.example.test",
      port: "5432",
      user: "analyst",
      database: "analytics",
      password: "",
    });
    expect(imported.profiles[0].url).toBe(
      "postgres://analyst@db.example.test:5432/analytics",
    );
  });

  it("imports DataGrip clipboard XML snippets", () => {
    const imported = importConnectionProfiles(
      `#DataSourceSettings#
      <data-source source="LOCAL" name="Reporting" uuid="reporting">
        <driver-ref>postgresql</driver-ref>
        <jdbc-url>jdbc:postgresql://reports.example.test:5432/reporting</jdbc-url>
        <user-name>reader</user-name>
      </data-source>`,
      "clipboard.txt",
    );

    expect(imported.profiles[0]).toMatchObject({
      id: "reporting",
      name: "Reporting",
      engine: "postgres",
      host: "reports.example.test",
      port: "5432",
      user: "reader",
      database: "reporting",
    });
  });

  it("imports pgAdmin servers.json", () => {
    const imported = importConnectionProfiles(
      JSON.stringify({
        Servers: {
          "1": {
            Name: "Prod",
            Host: "prod.example.test",
            Port: 5432,
            MaintenanceDB: "postgres",
            Username: "admin",
            SSLMode: "require",
          },
        },
      }),
      "servers.json",
    );

    expect(imported.profiles[0]).toMatchObject({
      name: "Prod",
      engine: "postgres",
      host: "prod.example.test",
      port: "5432",
      user: "admin",
      database: "postgres",
    });
  });

  it("imports MySQL Workbench connections.xml", () => {
    const imported = importConnectionProfiles(
      `<?xml version="1.0"?>
      <data>
        <value type="object" struct-name="db.mgmt.Connection" id="local">
          <value type="string" key="name">Local MySQL</value>
          <value type="dict" key="parameterValues">
            <value type="string" key="hostName">127.0.0.1</value>
            <value type="int" key="port">3306</value>
            <value type="string" key="userName">root</value>
            <value type="string" key="schema">sakila</value>
          </value>
        </value>
      </data>`,
      "connections.xml",
    );

    expect(imported.profiles[0]).toMatchObject({
      name: "Local MySQL",
      engine: "mysql",
      host: "127.0.0.1",
      port: "3306",
      user: "root",
      database: "sakila",
    });
  });

  it("exports all supported formats without passwords", () => {
    const profiles = [
      profile({
        mode: "url",
        url: "postgres://analyst:secret@db.example.test:5432/analytics?password=secret",
      }),
      profile({
        id: "mysql",
        name: "MySQL",
        engine: "mysql",
        host: "mysql.example.test",
        port: "3306",
      }),
    ];

    for (const format of [
      "irodori",
      "dbeaver",
      "datagrip",
      "tableplus",
      "pgadmin",
      "mysql-workbench",
      "heidisql",
      "sqltools",
    ] as const) {
      const exported = exportConnectionProfiles(profiles, format);
      expect(exported.content.toLowerCase()).not.toContain("secret");
      expect(exported.content.toLowerCase()).not.toContain("password=secret");
    }
  });
});
