import { expect, test } from "bun:test";

import { parseVault } from "../src/index";

// NordPass CSV shape from bitwarden/clients libs/importer/src/importers/nordpass-csv-importer.ts
// (NordPassCsvParsed): name,url,additional_urls,username,password,note,cardholdername,cardnumber,
// cvc,pin,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,
// state,type,custom_fields. `additional_urls` is a JSON string array, `custom_fields` a JSON array
// of { label, type, value }.
test("NordPass CSV keeps additional_urls and custom_fields", () => {
  const csv =
    "name,url,additional_urls,username,password,note,cardholdername,cardnumber,cvc,pin,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type,custom_fields\r\n" +
    `Site,https://a.example,"[""https://b.example"",""https://c.example""]",me,pw,,,,,,,,,,,,,,,,,password,"[{""label"":""Q"",""type"":""hidden"",""value"":""secret""}]"\r\n`;
  const parsed = parseVault(csv);
  expect(parsed.format).toBe("nordpass-csv");
  const item = parsed.vault.items[0];
  expect(item.login?.uris?.length).toBe(3);
  expect(item.fields?.[0]).toMatchObject({ name: "Q", value: "secret", type: 1 });
});

// KeePass 2.x writes <Meta><RecycleBinUUID> and names the root group after the database; the
// recycle bin group is localized (e.g. "Papierkorb"), and a user can own a group called
// "Recycle Bin" that is not the bin.
function kpxml(): string {
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile>
  <Meta><RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>AQEBAQEBAQEBAQEBAQEBAQ==</RecycleBinUUID></Meta>
  <Root>
    <Group>
      <UUID>AAAAAAAAAAAAAAAAAAAAAA==</UUID>
      <Name>MyDatabase</Name>
      <Entry><UUID>Ag==</UUID><String><Key>Title</Key><Value>top</Value></String></Entry>
      <Group><UUID>AQEBAQEBAQEBAQEBAQEBAQ==</UUID><Name>Papierkorb</Name>
        <Entry><UUID>Aw==</UUID><String><Key>Title</Key><Value>deleted</Value></String></Entry>
      </Group>
      <Group><UUID>AgICAgICAgICAgICAgICAg==</UUID><Name>Recycle Bin</Name>
        <Entry><UUID>BA==</UUID><String><Key>Title</Key><Value>mine</Value></String></Entry>
      </Group>
      <Group><UUID>AwMDAwMDAwMDAwMDAwMDAw==</UUID><Name>Work</Name>
        <Entry><UUID>BQ==</UUID><String><Key>Title</Key><Value>w</Value></String></Entry>
      </Group>
    </Group>
  </Root>
</KeePassFile>`;
}

test("KeePass XML skips the real recycle bin by UUID and keeps a user group named Recycle Bin", () => {
  const { vault } = parseVault(kpxml());
  const names = vault.items.map((i) => i.name).sort();
  expect(names).toEqual(["mine", "top", "w"]);
});

test("KeePass XML never uses the root group (database name) as a folder prefix", () => {
  const { vault } = parseVault(kpxml());
  const folderNames = (vault.folders ?? []).map((f) => f.name).sort();
  expect(folderNames).toEqual(["Recycle Bin", "Work"]);
});

// Keeper JSON typed custom fields are keyed `$<type>:<label>:<index>`; TOTP is `$oneTimeCode::1`
// (bitwarden/clients libs/importer/src/importers/keeper/keeper-json-importer.ts, importCustomFields).
test("Keeper JSON maps $oneTimeCode custom field to TOTP", () => {
  const json = JSON.stringify({
    shared_folders: [],
    records: [
      {
        title: "Site",
        $type: "login",
        login: "u",
        password: "p",
        login_url: "https://a.example",
        notes: "",
        custom_fields: { "$oneTimeCode::1": "otpauth://totp/x?secret=ABC", "$text:Pet:1": "rex" },
        folders: [],
        uid: "x",
      },
    ],
  });
  const item = parseVault(json).vault.items[0];
  expect(item.login?.totp).toBe("otpauth://totp/x?secret=ABC");
  expect(item.fields?.map((f) => f.name)).toEqual(["$text:Pet:1"]);
});
