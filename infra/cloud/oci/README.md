# Demo server as code (Terraform / OpenTofu, Oracle Cloud)

`main.tf` creates the whole server in one go: VCN, subnet, internet gateway, firewall rules (22, 80, 443) and an
**Always Free VM.Standard.A1.Flex** VM (4 OCPU, 24 GB, Oracle Linux 9). On first boot, `cloud-init.yaml`:
points the DuckDNS name at the VM, installs Docker, clones the repo, creates the operator password, trains the
health model, builds the sim and starts the stack from [../README.md](../README.md). It replaces steps 1 to 3 there.

## Once: tools and Oracle API key
1. Install [OpenTofu](https://opentofu.org/docs/intro/install/) (or Terraform: same commands, `terraform` instead of `tofu`).
2. Install the [OCI CLI](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm) and run `oci setup config`.
   It asks for your user OCID (Profile → My profile), tenancy OCID (Profile → Tenancy) and region `ap-singapore-1`,
   and creates an API key. Upload the public key it prints: Profile → My profile → API keys → Add API key → Paste.
   Check: `oci iam region list` works.
3. Have an SSH key: `ssh-keygen -t ed25519` if `~/.ssh/id_ed25519.pub` does not exist.

## Create the server
```bash
cd infra/cloud/oci
cp terraform.tfvars.example terraform.tfvars   # fill in: tenancy OCID, DuckDNS token, operator password
tofu init
tofu plan
until tofu apply -auto-approve; do echo "retrying in 60 s"; sleep 60; done
```
The loop is for "Out of host capacity", which A1 often returns in Singapore. Press Ctrl+C if the error is anything else.

Setup then runs on the VM for about 30 minutes (the ArduCopter build is most of it). Follow it with the
`setup_log` command that `tofu apply` prints, and wait for `NOAH ARK READY`. Then `curl https://<domain>/v1/health`.

Then do step 4 (GitHub Pages) of [../README.md](../README.md); `tofu output mqtt_url` prints the value to use.

## Update and remove
- New code on the branch: `ssh opc@<ip>` then `cd Noah-Ark && git pull && docker compose -f compose.yaml -f infra/cloud/compose.yaml up -d --build`.
- Remove everything this created: `tofu destroy`.
- Changing `cloud-init.yaml` or the passwords only applies to a new VM: `tofu apply -replace=oci_core_instance.ark`.

## Notes
- The DuckDNS token and operator password end up in `terraform.tfstate` and in the VM's metadata. Both are
  git-ignored here; do not share the state file.
- An instance you made by hand in the console is not managed by this. Terminate it there yourself, especially a paid shape like E5.Flex.
- Always Free allows 4 OCPU / 24 GB of A1 per tenancy in total, so a second A1 VM will not fit next to this one.
