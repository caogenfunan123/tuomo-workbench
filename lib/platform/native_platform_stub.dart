import 'ports.dart';

RemoteToolsPort createNativeRemoteTools(String baseUrl, String platform) =>
    UnavailableRemoteTools(platform);

WorkspaceRemotePort createNativeWorkspace(String baseUrl, String platform) =>
    UnavailableWorkspaceRemote(platform);
