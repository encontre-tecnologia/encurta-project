import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, Button, Platform } from "react-native";
import * as Location from "expo-location";
import { Audio } from "expo-av";
import { WebView } from "react-native-webview";

export default function App() {
  const [locationStatus, setLocationStatus] = useState("Aguardando...");
  const [audioStatus, setAudioStatus] = useState("Aguardando...");
  const [location, setLocation] = useState(null);
  const [permissoesConcedidas, setPermissoesConcedidas] = useState(false);

  const pedirPermissoes = async () => {
    let localizacaoOk = false;
    let audioOk = false;

    // Localização
    try {
      const { status: locationPermission } =
        await Location.requestForegroundPermissionsAsync();
      if (locationPermission === "granted") {
        setLocationStatus("✅ Localização CONCEDIDA");
        const currentLocation = await Location.getCurrentPositionAsync({});
        setLocation(currentLocation);
        localizacaoOk = true;
      } else {
        setLocationStatus("❌ Localização NEGADA");
      }
    } catch (error) {
      console.error("Erro ao pedir localização:", error);
    }

    // Microfone
    try {
      const { status: audioPermission } = await Audio.requestPermissionsAsync();
      if (audioPermission === "granted") {
        setAudioStatus("✅ Áudio CONCEDIDO");
        audioOk = true;
      } else {
        setAudioStatus("❌ Áudio NEGADO");
      }
    } catch (error) {
      console.error("Erro ao pedir áudio:", error);
    }

    // Só libera a WebView se os dois forem concedidos
    if (localizacaoOk && audioOk) {
      setPermissoesConcedidas(true);
    }
  };
  function enviarNotificacao(titulo, corpo) {
    if (Notification.permission === "granted") {
      new Notification(titulo, {
        body: corpo,
        icon: "https://example.com/icon.png", // opcional
      });
    }
  }

  useEffect(() => {
    pedirPermissoes();
  }, []);

  if (!permissoesConcedidas) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>📍 Localização: {locationStatus}</Text>
        <Text style={styles.title}>🎙️ Microfone: {audioStatus}</Text>
        <Button title="Tentar Novamente" onPress={pedirPermissoes} />
      </View>
    );
  }

  return (
    <WebView
      source={{ uri: "http://192.168.1.141:5500/index.html" }} // 👉 Troque aqui pela URL do seu site
      style={{ flex: 1 }}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      geolocationEnabled={true}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback={true}
      onMessage={(event) =>
        console.log("Mensagem da WebView:", event.nativeEvent.data)
      }
      startInLoadingState={true}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F0F4F8",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontWeight: "bold",
    fontSize: 16,
    marginBottom: 8,
  },
});
