package com.example.backendspring.user;

import jakarta.persistence.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "usuarios")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String username;

    @Column(nullable = false)
    private String password;

    @Column(nullable = false)
    private String role; // 'admin' | 'user'

    @Column(name = "pode_controlar_caixa")
    @lombok.Builder.Default
    private Boolean podeControlarCaixa = Boolean.FALSE;
}
